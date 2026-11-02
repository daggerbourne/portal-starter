import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAuditSink } from "../../../core/adapter-gate/memory-audit-sink.js";
import { config as callbackConfig } from "../../../server/functions/auth-callback.js";
import { config as loginConfig } from "../../../server/functions/auth-login.js";
import { config as logoutConfig } from "../../../server/functions/auth-logout.js";
import { config as sessionConfig } from "../../../server/functions/auth-session.js";
import { handleSettings, type AdminDeps, type Sql } from "../../../server/admin/shell.js";
import { entraIds } from "../../../server/auth/config.js";
import {
  handleCallback,
  handleLogin,
  handleLogout,
  handleSession,
  memoryStaffDirectory,
  type AuthDeps,
  type StaffDirectory,
  type StaffRecord,
} from "../../../server/auth/staff-sign-in.js";

const SPRING = "2026-03-08T07:30:00.000Z";
const FALL = "2026-11-01T06:30:00.000Z";
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOCAL = "http://localhost:8888/portal-starter/auth/login";
const CALLBACK = "http://localhost:8888/portal-starter/auth/callback";
const SESSION = "http://localhost:8888/portal-starter/auth/session";
const PREVIEW = "https://deploy-preview-27--portal-starter.netlify.app/portal-starter/auth/login";
const STAFF_EMAIL = "person@example.test";
const STAFF: StaffRecord = { objectId: "oid-staff", role: "staff" };
const OWNER: StaffRecord = { objectId: "oid-owner", role: "owner" };

const ROLE_ENV = {
  APP_ROLE: "owner",
  ROLE: "owner",
  APP_ACTING_ROLE: "owner",
  DEV_ROLE: "owner",
  APP_ADMIN: "1",
  ADMIN: "1",
  APP_DEV_ROLE: "owner",
  APP_CUSTOM_ROLE: "owner",
  USER_ROLE: "owner",
};

function unsignedIdToken(claims: { readonly [key: string]: unknown }): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.unsigned`;
}

function countingDirectory(records: readonly StaffRecord[]): {
  directory: StaffDirectory;
  calls: () => number;
} {
  let calls = 0;
  const inner = memoryStaffDirectory(records);
  return {
    calls: () => calls,
    directory: {
      findByObjectId(objectId) {
        calls += 1;
        return inner.findByObjectId(objectId);
      },
    },
  };
}

function harness(options?: {
  records?: readonly StaffRecord[];
  env?: { readonly [name: string]: string | undefined };
  now?: string;
}): {
  deps: AuthDeps;
  sink: ReturnType<typeof createMemoryAuditSink>;
  tokens: Map<string, string>;
  directoryCalls: () => number;
  reads: () => number;
  transports: () => number;
  at: (iso: string) => void;
  advance: (ms: number) => void;
} {
  let now = new Date(options?.now ?? SPRING);
  const tokens = new Map<string, string>();
  const sink = createMemoryAuditSink();
  const counted = countingDirectory(options?.records ?? []);
  let reads = 0;
  let transports = 0;
  const deps: AuthDeps = {
    env: {
      MODE: "mock",
      APP_DEPLOY_CONTEXT: "dev",
      APP_SESSION_KEY: "synthetic-session-key",
      ...options?.env,
    },
    clock: () => now,
    directory: counted.directory,
    audit: sink,
    mockIdToken: (code) => tokens.get(code),
    transport: () => {
      transports += 1;
      return Promise.reject(new Error("transport called"));
    },
    readData: (staff) => {
      reads += 1;
      return Promise.resolve(Response.json({ role: staff.role }));
    },
  };
  return {
    deps,
    sink,
    tokens,
    directoryCalls: counted.calls,
    reads: () => reads,
    transports: () => transports,
    at(iso: string) {
      now = new Date(iso);
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

function request(
  url: string,
  init?: { readonly cookie?: string; readonly headers?: { readonly [name: string]: string } },
): Request {
  const headers = new Headers(init?.headers);
  if (init?.cookie !== undefined) headers.set("cookie", init.cookie);
  return new Request(url, { headers });
}

function cookieNamed(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}

function cookiePair(header: string | undefined): string {
  if (header === undefined) return "";
  return header.split(";")[0] ?? "";
}

function assertSealed(header: string | undefined): void {
  assert.ok(header);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\/portal-starter/);
}

async function callbackFor(
  h: ReturnType<typeof harness>,
  claims: { readonly [key: string]: unknown },
  query?: { readonly state?: string; readonly extra?: string },
): Promise<{ login: Response; callback: Response }> {
  const login = handleLogin(request(LOCAL), h.deps);
  const location = new URL(login.headers.get("location") ?? "http://invalid.example/");
  const state = query?.state ?? location.searchParams.get("state") ?? "";
  const nonce = location.searchParams.get("nonce") ?? "";
  const ids = entraIds(h.deps.env);
  const code = "synthetic-code";
  h.tokens.set(
    code,
    unsignedIdToken({
      iss: `https://login.microsoftonline.com/${ids.tenantId}/v2.0`,
      aud: ids.clientId,
      exp: Math.floor(h.deps.clock().getTime() / 1000) + 3600,
      nonce,
      oid: STAFF.objectId,
      email: STAFF_EMAIL,
      roles: ["PortalStarter.Staff"],
      ...claims,
    }),
  );
  const extra = query?.extra ?? "";
  const callback = await handleCallback(
    request(`${CALLBACK}?code=${code}&state=${encodeURIComponent(state)}${extra}`, {
      cookie: cookiePair(cookieNamed(login, "app_login")),
      headers: { role: "owner", "x-role": "owner", "x-app-role": "owner" },
    }),
    h.deps,
  );
  return { login, callback };
}

test("auth routes publish their paths", () => {
  assert.equal(loginConfig.path, "/portal-starter/auth/login");
  assert.equal(callbackConfig.path, "/portal-starter/auth/callback");
  assert.equal(logoutConfig.path, "/portal-starter/auth/logout");
  assert.equal(sessionConfig.path, "/portal-starter/auth/session");
});

test("login redirects to the tenant authorize endpoint", () => {
  const h = harness();
  const hosts = [
    [LOCAL, "http://localhost:8888/portal-starter/auth/callback"],
    [
      "https://main--portal-starter.netlify.app/portal-starter/auth/login",
      "https://main--portal-starter.netlify.app/portal-starter/auth/callback",
    ],
    [
      "https://portal-starter.netlify.app/portal-starter/auth/login",
      "https://portal-starter.netlify.app/portal-starter/auth/callback",
    ],
  ] as const;
  for (const [url, redirectUri] of hosts) {
    const response = handleLogin(request(url), h.deps);
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    const ids = entraIds({});
    assert.equal(
      `${location.origin}${location.pathname}`,
      `https://login.microsoftonline.com/${ids.tenantId}/oauth2/v2.0/authorize`,
    );
    assert.equal(location.searchParams.get("client_id"), ids.clientId);
    assert.equal(location.searchParams.get("response_type"), "code");
    assert.equal(location.searchParams.get("redirect_uri"), redirectUri);
    assert.equal(location.searchParams.get("scope"), "openid profile email");
    const state = location.searchParams.get("state");
    const nonce = location.searchParams.get("nonce");
    assert.equal(typeof state, "string");
    assert.notEqual(state, "");
    assert.notEqual(nonce, "");
    assert.notEqual(state, nonce);
    assert.equal(location.searchParams.get("client_secret"), null);
    const ticket = cookieNamed(response, "app_login");
    assertSealed(ticket);
    assert.match(ticket ?? "", /Max-Age=600/);
    assert.equal(h.sink.rows().length, 0);
    assert.equal(h.transports(), 0);
  }
});

test("a preview login says sign-in is unavailable and calls no adapter", () => {
  const h = harness({ env: { MODE: "live", APP_DEPLOY_CONTEXT: "dev", APP_ENTRA_CLIENT_SECRET: "synthetic-secret" } });
  for (const url of [PREVIEW, "https://evil.example/portal-starter/auth/login"]) {
    const response = handleLogin(request(url), h.deps);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(cookieNamed(response, "app_login"), undefined);
  }
  return handleLogin(request(PREVIEW), h.deps).text().then((body) => {
    assert.equal(body, "sign-in isn't available on previews");
    assert.equal(h.sink.rows().length, 0);
    assert.equal(h.transports(), 0);
    assert.equal(h.directoryCalls(), 0);
  });
});

test("callback rejects a bad state, nonce, issuer, audience, or expiry and sets no session", async () => {
  const cases: { readonly name: string; readonly claims: { readonly [key: string]: unknown }; readonly state?: string }[] = [
    { name: "state", claims: {}, state: "wrong-state" },
    { name: "nonce", claims: { nonce: "wrong-nonce" } },
    { name: "iss", claims: { iss: "https://login.microsoftonline.com/other.example/v2.0" } },
    { name: "aud", claims: { aud: "other-client" } },
    { name: "exp", claims: { exp: 1 } },
  ];
  for (const item of cases) {
    const h = harness({ records: [STAFF] });
    const { callback } = await callbackFor(h, item.claims, { state: item.state });
    assert.equal(callback.status, 403, item.name);
    assert.equal(cookieNamed(callback, "app_session"), undefined, item.name);
    assert.equal(await callback.text(), "forbidden", item.name);
    if (item.name === "state") {
      assert.equal(h.sink.rows().length, 0, item.name);
      assert.equal(h.directoryCalls(), 0, item.name);
    } else {
      assert.equal(h.sink.rows().length, 1, item.name);
      assert.equal(h.sink.rows()[0]?.outcome, "allowed", item.name);
      assert.equal(h.directoryCalls(), 0, item.name);
    }
  }
});

test("a staff callback sets a sealed session and a later read sees the directory role", async () => {
  const h = harness({ records: [STAFF] });
  const { callback } = await callbackFor(h, {});
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/portal-starter/admin");
  const sealed = cookieNamed(callback, "app_session");
  assertSealed(sealed);
  assert.match(sealed ?? "", /Max-Age=43200/);
  assert.equal((sealed ?? "").includes(STAFF_EMAIL), false);
  assert.equal((await callback.text()).includes(STAFF_EMAIL), false);
  assert.equal(h.directoryCalls(), 1);
  const later = harness({ records: [STAFF] });
  const session = await handleSession(request(SESSION, { cookie: cookiePair(sealed) }), later.deps);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { role: "staff" });
  assert.equal(later.directoryCalls(), 0);
  assert.equal(later.reads(), 1);
});

test("role env, headers, and query do not change a caller's role", async () => {
  const staff = harness({ records: [STAFF], env: ROLE_ENV });
  const staffCallback = await callbackFor(staff, {}, { extra: "&role=owner&APP_ROLE=owner&admin=1" });
  const staffSession = await handleSession(
    request(`${SESSION}?role=owner&APP_ROLE=staff`, {
      cookie: cookiePair(cookieNamed(staffCallback.callback, "app_session")),
      headers: { role: "owner", "x-role": "owner" },
    }),
    staff.deps,
  );
  assert.deepEqual(await staffSession.json(), { role: "staff" });

  const owner = harness({ records: [OWNER], env: { ...ROLE_ENV, APP_ROLE: "staff", ROLE: "staff" } });
  const ownerCallback = await callbackFor(owner, { oid: OWNER.objectId, email: "owner@example.test" });
  const ownerSession = await handleSession(
    request(SESSION, { cookie: cookiePair(cookieNamed(ownerCallback.callback, "app_session")) }),
    owner.deps,
  );
  assert.deepEqual(await ownerSession.json(), { role: "owner" });

  const unknown = harness({ records: [STAFF], env: { ...ROLE_ENV, APP_ROLE: "staff" } });
  const unknownCallback = await callbackFor(unknown, {
    oid: "oid-unknown",
    email: "unknown@example.test",
    roles: ["owner"],
  });
  assert.equal(unknownCallback.callback.status, 403);
  const unknownSession = await handleSession(
    request(SESSION, { cookie: cookiePair(cookieNamed(unknownCallback.callback, "app_session")) }),
    harness().deps,
  );
  assert.equal(unknownSession.status, 403);
  assert.equal((await unknownSession.text()).includes("staff"), false);
});

test("a signed-in non-staff user, a missing cookie, and a forged cookie get 403 before any read", async () => {
  const signedIn = harness({ records: [] });
  const { callback } = await callbackFor(signedIn, { oid: "oid-visitor", roles: ["owner"] });
  assert.equal(callback.status, 403);
  assertSealed(cookieNamed(callback, "app_session"));
  const probe = harness({ records: [STAFF] });
  const cases = [
    cookiePair(cookieNamed(callback, "app_session")),
    undefined,
    "app_session=forged.not-a-signature",
  ];
  for (const cookie of cases) {
    const beforeDirectory = probe.directoryCalls();
    const beforeReads = probe.reads();
    const response = await handleSession(request(SESSION, cookie === undefined ? {} : { cookie }), probe.deps);
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "forbidden");
    assert.equal(probe.directoryCalls(), beforeDirectory);
    assert.equal(probe.reads(), beforeReads);
  }
});

test("a tampered or expired session cookie is refused", async () => {
  for (const issued of [SPRING, FALL]) {
    const h = harness({ records: [STAFF], now: issued });
    const { callback } = await callbackFor(h, {});
    const sealed = cookieNamed(callback, "app_session");
    assert.match(sealed ?? "", /Max-Age=43200/);
    const pair = cookiePair(sealed);
    const fresh = harness({ records: [STAFF], now: issued });
    fresh.advance(SESSION_MS - 1);
    const still = await handleSession(request(SESSION, { cookie: pair }), fresh.deps);
    assert.equal(still.status, 200);
    assert.equal(fresh.reads(), 1);
    fresh.advance(1);
    const expired = await handleSession(request(SESSION, { cookie: pair }), fresh.deps);
    assert.equal(expired.status, 403);
    assert.equal(fresh.reads(), 1);
    const flipped = pair.endsWith("a") ? `${pair.slice(0, -1)}b` : `${pair.slice(0, -1)}a`;
    const tampered = await handleSession(request(SESSION, { cookie: flipped }), fresh.deps);
    assert.equal(tampered.status, 403);
    assert.equal(fresh.directoryCalls(), 0);
  }
});

test("logout clears the browser session and a second logout stays signed out", async () => {
  const h = harness({ records: [STAFF] });
  const { callback } = await callbackFor(h, {});
  assert.ok(cookieNamed(callback, "app_session"));
  const first = handleLogout();
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "signed out");
  assert.match(cookieNamed(first, "app_session") ?? "", /Max-Age=0/);
  const second = handleLogout();
  assert.equal(second.status, 200);
  assert.match(cookieNamed(second, "app_session") ?? "", /Max-Age=0/);
  const after = await handleSession(request(SESSION), h.deps);
  assert.equal(after.status, 403);
  assert.equal(h.reads(), 0);
});

test("a second callback for the same staff member keeps the staff role", async () => {
  const h = harness({ records: [STAFF] });
  const first = await callbackFor(h, {});
  const second = await callbackFor(h, {});
  assert.equal(first.callback.status, 302);
  assert.equal(second.callback.status, 302);
  const session = await handleSession(
    request(SESSION, { cookie: cookiePair(cookieNamed(second.callback, "app_session")) }),
    h.deps,
  );
  assert.deepEqual(await session.json(), { role: "staff" });
  assert.equal(h.sink.rows().length, 2);
  assert.deepEqual(
    h.sink.rows().map((row) => row.outcome),
    ["allowed", "allowed"],
  );
});

test("the callback refuses a killed gate and live mode outside production", async () => {
  const killed = harness({ records: [STAFF], env: { APP_KILL: "1" } });
  const killedCallback = await callbackFor(killed, {});
  assert.equal(killedCallback.callback.status, 403);
  assert.equal(cookieNamed(killedCallback.callback, "app_session"), undefined);
  assert.equal(killed.sink.rows()[0]?.outcome, "killed");
  assert.equal(killed.directoryCalls(), 0);
  assert.equal(killed.transports(), 0);

  const live = harness({
    records: [STAFF],
    env: { MODE: "live", APP_DEPLOY_CONTEXT: "dev", APP_ENTRA_CLIENT_SECRET: "synthetic-secret" },
  });
  const liveCallback = await callbackFor(live, {});
  assert.equal(liveCallback.callback.status, 403);
  assert.equal(cookieNamed(liveCallback.callback, "app_session"), undefined);
  assert.equal(live.sink.rows()[0]?.outcome, "live_refused");
  assert.equal(live.transports(), 0);
  assert.equal(JSON.stringify(live.sink.rows()).includes("synthetic-secret"), false);
});

test("a preview callback does not call the adapter", async () => {
  const h = harness({ env: { MODE: "live" } });
  const response = await handleCallback(
    request("https://deploy-preview-27--portal-starter.netlify.app/portal-starter/auth/callback?code=abc&state=abc"),
    h.deps,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "sign-in isn't available on previews");
  assert.equal(cookieNamed(response, "app_session"), undefined);
  assert.equal(h.sink.rows().length, 0);
  assert.equal(h.directoryCalls(), 0);
});

test("missing session key fails closed on an allowlisted host", () => {
  const h = harness({ env: { APP_SESSION_KEY: "" } });
  const response = handleLogin(request(LOCAL), h.deps);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("location"), null);
  assert.equal(h.sink.rows().length, 0);
});

test("auth-test login redirects to Entra with the auth-test callback", () => {
  const h = harness();
  const response = handleLogin(
    request("https://auth-test--portal-starter.netlify.app/portal-starter/auth/login"),
    h.deps,
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://auth-test--portal-starter.netlify.app/portal-starter/auth/callback",
  );
  assert.equal(h.sink.rows().length, 0);
  assert.equal(h.transports(), 0);
});

test("a nearby host is still a preview", async () => {
  const h = harness();
  const hosts = [
    "https://deploy-preview-56--portal-starter.netlify.app/portal-starter/auth/login",
    "https://auth-test-x--portal-starter.netlify.app/portal-starter/auth/login",
    "https://auth-test--portal-starter.netlify.app.evil.test/portal-starter/auth/login",
  ];
  for (const url of hosts) {
    const response = handleLogin(request(url), h.deps);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get("location"), null, url);
    assert.equal(cookieNamed(response, "app_login"), undefined, url);
    assert.equal(await response.text(), "sign-in isn't available on previews", url);
  }
  assert.equal(h.sink.rows().length, 0);
  assert.equal(h.directoryCalls(), 0);
});

test("the staff app role grants a session and any other roles claim is forbidden before a read", async () => {
  const admitted = harness({ records: [] });
  const admittedCallback = await callbackFor(admitted, { roles: ["PortalStarter.Staff"] });
  assert.equal(admittedCallback.callback.status, 302);
  assert.equal(admittedCallback.callback.headers.get("location"), "/portal-starter/admin");
  assert.equal(admitted.directoryCalls(), 1);
  assert.equal(admitted.reads(), 0);
  const admittedSession = await handleSession(
    request(SESSION, { cookie: cookiePair(cookieNamed(admittedCallback.callback, "app_session")) }),
    admitted.deps,
  );
  assert.equal(admittedSession.status, 200);
  assert.deepEqual(await admittedSession.json(), { role: "staff" });

  const deniedClaims: { readonly [key: string]: unknown }[] = [
    { roles: undefined },
    { roles: ["portalstarter.staff"] },
    { roles: "PortalStarter.Staff" },
    { roles: ["Other"] },
  ];
  for (const claims of deniedClaims) {
    const denied = harness({ records: [STAFF], env: ROLE_ENV });
    const deniedCallback = await callbackFor(denied, claims);
    assert.equal(deniedCallback.callback.status, 403);
    assert.equal(await deniedCallback.callback.text(), "forbidden");
    assert.equal(denied.directoryCalls(), 0);
    assert.equal(denied.reads(), 0);
  }

  const owner = harness({ records: [OWNER] });
  const ownerCallback = await callbackFor(owner, { oid: OWNER.objectId, roles: ["PortalStarter.Staff", "Other"] });
  assert.equal(ownerCallback.callback.status, 302);
  assert.equal(owner.reads(), 0);
  const ownerSession = await handleSession(
    request(SESSION, { cookie: cookiePair(cookieNamed(ownerCallback.callback, "app_session")) }),
    owner.deps,
  );
  assert.deepEqual(await ownerSession.json(), { role: "owner" });

  let settingsReads = 0;
  const settingsDb: Sql = {
    query() {
      return Promise.resolve({ rows: [] });
    },
    end() {
      return Promise.resolve();
    },
  };
  const settings: AdminDeps = {
    env: { ...owner.deps.env, DATABASE_URL: "postgres://example.test/portal-starter" },
    clock: owner.deps.clock,
    connect() {
      return Promise.resolve(settingsDb);
    },
    session: () => owner.deps,
    readers: {
      users: () => Promise.resolve(""),
      user: () => Promise.resolve(""),
      settings() {
        settingsReads += 1;
        return Promise.resolve("<p>settings</p>");
      },
    },
  };
  const page = await handleSettings(
    request("http://localhost:8888/portal-starter/admin/settings", {
      cookie: cookiePair(cookieNamed(ownerCallback.callback, "app_session")),
    }),
    settings,
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<p>settings<\/p>/);
  assert.equal(settingsReads, 1);
});

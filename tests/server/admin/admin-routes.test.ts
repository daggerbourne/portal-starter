import assert from "node:assert/strict";
import { test } from "node:test";
import { entraIds } from "../../../server/auth/config.js";
import { handleCallback, handleLogin, memoryStaffDirectory, type AuthDeps, type StaffRole } from "../../../server/auth/staff-sign-in.js";
import { handleUser, handleUsers, handleSettings, productionAdminDeps, type AdminDeps, type AdminReaders, type Sql } from "../../../server/admin/shell.js";
import { config as userConfig } from "../../../server/functions/admin-user.js";
import adminUser from "../../../server/functions/admin-user.js";
import { config as usersConfig } from "../../../server/functions/admin-users.js";
import adminUsers from "../../../server/functions/admin-users.js";
import { config as settingsConfig } from "../../../server/functions/admin-settings.js";
import adminSettings from "../../../server/functions/admin-settings.js";

const KEY = "synthetic-session-key";
const ISSUED = new Date("2026-03-08T07:30:00.000Z");
const SESSION_MS = 12 * 60 * 60 * 1000;
const LABEL = "synthetic-dev";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOSTILE = "1'; DROP TABLE app_user;--";

type Calls = {
  users: number;
  user: number;
  settings: number;
  connect: number;
  queries: { text: string; values: readonly unknown[] }[];
};

function unsignedIdToken(claims: { readonly [key: string]: unknown }): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.unsigned`;
}

function env(extra: { readonly [name: string]: string | undefined } = {}): { readonly [name: string]: string | undefined } {
  return {
    MODE: "mock",
    APP_DEPLOY_CONTEXT: "dev",
    APP_SESSION_KEY: KEY,
    APP_DB_LABEL: LABEL,
    DATABASE_URL: "postgres://example.test/portal-starter",
    ...extra,
  };
}

async function sessionCookie(role: StaffRole | "none", clock: () => Date): Promise<string> {
  const objectId = role === "owner" ? "oid-owner" : role === "staff" ? "oid-staff" : "oid-visitor";
  const tokens = new Map<string, string>();
  const deps: AuthDeps = {
    env: env(),
    clock,
    directory: memoryStaffDirectory(role === "none" ? [] : [{ objectId, role }]),
    audit: { write() { return undefined; } },
    mockIdToken: (code) => tokens.get(code),
    transport: () => Promise.reject(new Error("transport called")),
    readData: () => Promise.resolve(new Response("unread")),
  };
  const login = handleLogin(new Request("http://localhost:8888/portal-starter/auth/login"), deps);
  const location = new URL(login.headers.get("location") ?? "http://invalid.example/");
  const ids = entraIds(deps.env);
  const code = "synthetic-code";
  tokens.set(code, unsignedIdToken({
    iss: `https://login.microsoftonline.com/${ids.tenantId}/v2.0`,
    aud: ids.clientId,
    exp: Math.floor(clock().getTime() / 1000) + 3600,
    nonce: location.searchParams.get("nonce"),
    oid: objectId,
    email: "person@example.test",
    roles: role === "none" ? ["owner"] : ["PortalStarter.Staff"],
  }));
  const ticket = login.headers.getSetCookie().find((item) => item.startsWith("app_login="))?.split(";")[0] ?? "";
  const callback = await handleCallback(
    new Request(`http://localhost:8888/portal-starter/auth/callback?code=${code}&state=${encodeURIComponent(location.searchParams.get("state") ?? "")}`, {
      headers: { cookie: ticket },
    }),
    deps,
  );
  return callback.headers.getSetCookie().find((item) => item.startsWith("app_session="))?.split(";")[0] ?? "";
}

function harness(values: { readonly [name: string]: string | undefined }, clock: () => Date, readers?: AdminReaders): { deps: AdminDeps; calls: Calls } {
  const calls: Calls = { users: 0, user: 0, settings: 0, connect: 0, queries: [] };
  const sql: Sql = {
    query(text, valuesSeen) {
      calls.queries.push({ text, values: [...valuesSeen] });
      return Promise.resolve({ rows: [] });
    },
    end() {
      return Promise.resolve();
    },
  };
  const fallback: AdminReaders = {
    users() {
      calls.users += 1;
      return Promise.resolve("<p>users</p>");
    },
    user() {
      calls.user += 1;
      return Promise.resolve("<p>user</p>");
    },
    settings() {
      calls.settings += 1;
      return Promise.resolve("<p>settings</p>");
    },
  };
  return {
    calls,
    deps: {
      env: values,
      clock,
      connect() {
        calls.connect += 1;
        return Promise.resolve(sql);
      },
      session: () => ({
        env: values,
        clock,
        directory: memoryStaffDirectory([]),
        audit: { write() { return undefined; } },
        mockIdToken: () => undefined,
        transport: () => Promise.reject(new Error("transport called")),
        readData: () => Promise.resolve(new Response("unread")),
      }),
      readers: readers ?? fallback,
    },
  };
}

function request(pathname: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined && cookie !== "") headers.set("cookie", cookie);
  return new Request(`http://localhost${pathname}`, { headers });
}

test("admin routes publish their paths", () => {
  assert.equal(usersConfig.path, "/portal-starter/admin");
  assert.equal(userConfig.path, "/portal-starter/admin/users/:id");
  assert.equal(settingsConfig.path, "/portal-starter/admin/settings");
});

test("a request with no cookie is forbidden before a database client exists", async () => {
  const previousContext = process.env.APP_DEPLOY_CONTEXT;
  const previousHost = process.env.APP_PROD_DB_HOST;
  const previousMode = process.env.MODE;
  process.env.MODE = "mock";
  process.env.APP_DEPLOY_CONTEXT = "dev";
  process.env.APP_PROD_DB_HOST = "app-prod-guard.example.test";
  try {
    const list = await adminUsers(request("/portal-starter/admin"));
    const detail = await adminUser(request(`/portal-starter/admin/users/${USER_ID}`));
    const settings = await adminSettings(request("/portal-starter/admin/settings"));
    assert.equal(list.status, 403);
    assert.equal(detail.status, 403);
    assert.equal(settings.status, 403);
    assert.equal(await list.text(), "forbidden");
  } finally {
    if (previousContext === undefined) delete process.env.APP_DEPLOY_CONTEXT;
    else process.env.APP_DEPLOY_CONTEXT = previousContext;
    if (previousHost === undefined) delete process.env.APP_PROD_DB_HOST;
    else process.env.APP_PROD_DB_HOST = previousHost;
    if (previousMode === undefined) delete process.env.MODE;
    else process.env.MODE = previousMode;
  }
});

test("a missing, forged, expired, or non-staff session is forbidden before any read", async () => {
  let now = new Date(ISSUED);
  const clock = () => now;
  const staff = await sessionCookie("staff", clock);
  now = new Date(ISSUED.getTime() + SESSION_MS);
  const visitor = await sessionCookie("none", clock);
  const { deps, calls } = harness(env(), clock);
  const cases = [undefined, "app_session=forged.not-a-signature", staff, visitor];
  for (const cookie of cases) {
    const list = await handleUsers(request("/portal-starter/admin", cookie), deps);
    const detail = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, cookie), deps);
    const settings = await handleSettings(request("/portal-starter/admin/settings", cookie), deps);
    assert.equal(list.status, 403);
    assert.equal(detail.status, 403);
    assert.equal(settings.status, 403);
    assert.equal(await list.text(), "forbidden");
  }
  assert.equal(calls.connect, 0);
  assert.equal(calls.users, 0);
  assert.equal(calls.user, 0);
  assert.equal(calls.settings, 0);
  assert.deepEqual(calls.queries, []);
});

test("staff can open the users list and a user, and settings stays owner-only", async () => {
  const clock = () => ISSUED;
  const staff = await sessionCookie("staff", clock);
  const owner = await sessionCookie("owner", clock);
  const staffHarness = harness(env(), clock);
  const list = await handleUsers(request("/portal-starter/admin", staff), staffHarness.deps);
  const detail = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, staff), staffHarness.deps);
  const settings = await handleSettings(request("/portal-starter/admin/settings", staff), staffHarness.deps);
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(settings.status, 403);
  assert.equal(await settings.text(), "forbidden");
  assert.equal(staffHarness.calls.users, 1);
  assert.equal(staffHarness.calls.user, 1);
  assert.equal(staffHarness.calls.settings, 0);
  assert.equal(staffHarness.calls.connect, 2);
  const ownerHarness = harness(env(), clock);
  const ownerUsers = await handleUsers(request("/portal-starter/admin", owner), ownerHarness.deps);
  const ownerUser = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, owner), ownerHarness.deps);
  const ownerSettings = await handleSettings(request("/portal-starter/admin/settings", owner), ownerHarness.deps);
  assert.equal(ownerUsers.status, 200);
  assert.equal(ownerUser.status, 200);
  assert.equal(ownerSettings.status, 200);
  assert.equal(ownerHarness.calls.settings, 1);
  assert.match(await ownerSettings.text(), /<p>settings<\/p>/);
});

test("outside production every admin page shows the database label and noindex", async () => {
  const clock = () => ISSUED;
  const staff = await sessionCookie("staff", clock);
  const labeled = harness(env(), clock);
  const body = await (await handleUsers(request("/portal-starter/admin", staff), labeled.deps)).text();
  assert.match(body, /DEV\/preview environment\. Test data only\./);
  assert.match(body, new RegExp(LABEL));
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(body, /href="\/portal-starter\/tokens\.css"/);
  assert.match(body, /<p>users<\/p>/);
  const unset = harness(env({ APP_DEPLOY_CONTEXT: undefined, APP_DB_LABEL: "  " }), clock);
  const unsetBody = await (await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, staff), unset.deps)).text();
  assert.match(unsetBody, /DEV\/preview environment\. Test data only\./);
  assert.match(unsetBody, /database: not set/);
  const production = harness(env({ APP_DEPLOY_CONTEXT: " production " }), clock);
  const productionBody = await (await handleSettings(request("/portal-starter/admin/settings", await sessionCookie("owner", clock)), production.deps)).text();
  assert.equal(productionBody.includes("DEV/preview environment"), false);
  assert.equal(productionBody.includes("app-dev-banner"), false);
  assert.match(productionBody, /<meta name="robots" content="noindex, nofollow">/);
});

test("an authorized request without a database url gets 503 and an unauthorized one stays 403", async () => {
  const clock = () => ISSUED;
  const staff = await sessionCookie("staff", clock);
  const missing = harness(env({ DATABASE_URL: undefined }), clock);
  const list = await handleUsers(request("/portal-starter/admin", staff), missing.deps);
  const blank = harness(env({ DATABASE_URL: "   ", APP_DB_LABEL: undefined }), clock);
  const detail = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, staff), blank.deps);
  assert.equal(list.status, 503);
  assert.equal(detail.status, 503);
  assert.match(await list.text(), /The database isn't configured\./);
  assert.match(await detail.text(), /database: not set/);
  assert.equal(missing.calls.connect, 0);
  assert.equal(blank.calls.connect, 0);
  assert.equal(missing.calls.users, 0);
  const refused = harness(env({ DATABASE_URL: undefined }), clock);
  const denied = await handleUsers(request("/portal-starter/admin"), refused.deps);
  assert.equal(denied.status, 403);
  assert.equal(refused.calls.connect, 0);
  assert.equal(refused.calls.users, 0);
});

test("a hostile user id is not queried and a real id is a parameter", async () => {
  const clock = () => ISSUED;
  const staff = await sessionCookie("staff", clock);
  const { deps, calls } = harness(env(), clock, productionAdminDeps().readers);
  const missing = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, staff), deps);
  assert.equal(missing.status, 404);
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.queries[0]?.text.includes("$1"), true);
  assert.equal(calls.queries[0]?.text.includes(USER_ID), false);
  assert.deepEqual(calls.queries[0]?.values, [USER_ID]);
  const before = calls.connect;
  const hostile = await handleUser(request(`/portal-starter/admin/users/${encodeURIComponent(HOSTILE)}`, staff), deps);
  assert.equal(hostile.status, 404);
  assert.match(await hostile.text(), /Not found/);
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.connect, before);
  const list = await handleUsers(request("/portal-starter/admin", staff), deps);
  assert.equal(list.status, 200);
  assert.deepEqual(calls.queries[1]?.values, []);
  assert.equal(calls.queries[1]?.text.includes("'"), false);
});

test("an unknown user is not found", async () => {
  const clock = () => ISSUED;
  const staff = await sessionCookie("staff", clock);
  const { deps, calls } = harness(env(), clock, {
    users: () => Promise.resolve(""),
    settings: () => Promise.resolve(""),
    user() {
      calls.user += 1;
      return Promise.resolve(undefined);
    },
  });
  const response = await handleUser(request(`/portal-starter/admin/users/${USER_ID}`, staff), deps);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Not found/);
  assert.equal(calls.user, 1);
});

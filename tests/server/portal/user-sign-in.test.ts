import assert from "node:assert/strict";
import { test } from "node:test";
import { handleUsers, type AdminDeps } from "../../../server/admin/shell.js";
import { memoryStaffDirectory } from "../../../server/auth/staff-sign-in.js";
import { config as callbackConfig } from "../../../server/functions/portal-callback.js";
import { config as homeConfig } from "../../../server/functions/portal-home.js";
import { config as loginConfig } from "../../../server/functions/portal-login.js";
import { config as logoutConfig } from "../../../server/functions/portal-logout.js";
import { portalPage } from "../../../server/portal/wire.js";
import {
  handleUserCallback,
  handleUserLogin,
  handleUserLogout,
  handleUserSession,
  memoryUserDirectory,
  stubUserProvider,
  USER_SESSION_COOKIE,
  type PortalDeps,
  type UserDirectory,
  type UserIdentity,
  type UserSignInProvider,
} from "../../../server/portal/user-sign-in.js";

const USER_KEY = "synthetic-user-session-key";
const STAFF_KEY = "synthetic-staff-session-key";
const ISSUED = new Date("2026-03-08T07:30:00.000Z");
const SESSION_MS = 12 * 60 * 60 * 1000;

const ADA: UserIdentity = { provider: "fake", subject: "subject-ada", email: "ada@example.test", displayName: "Ada Hollow" };

function fakeProvider(identity: UserIdentity | undefined): UserSignInProvider {
  return {
    name: "fake",
    start: () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://idp.example.test/authorize" } })),
    finish: () => Promise.resolve(identity),
  };
}

function deps(input: {
  readonly provider?: UserSignInProvider;
  readonly directory?: UserDirectory;
  readonly env?: { readonly [name: string]: string | undefined };
  readonly clock?: () => Date;
  readonly reads?: string[];
}): PortalDeps {
  return {
    env: input.env ?? { APP_USER_SESSION_KEY: USER_KEY, APP_SESSION_KEY: STAFF_KEY, APP_DEPLOY_CONTEXT: "dev" },
    clock: input.clock ?? (() => ISSUED),
    provider: input.provider ?? fakeProvider(ADA),
    directory: input.directory ?? memoryUserDirectory(),
    readData: (user) => {
      input.reads?.push(user.id);
      return Promise.resolve(new Response(`portal for ${user.displayName}`));
    },
  };
}

function request(path: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined && cookie !== "") headers.set("cookie", cookie);
  return new Request(`http://localhost:8888${path}`, { headers });
}

function cookiePair(response: Response, name: string): string {
  return response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`))?.split(";")[0] ?? "";
}

async function signedIn(portal: PortalDeps): Promise<string> {
  const callback = await handleUserCallback(request("/portal-starter/portal/auth/callback"), portal);
  assert.equal(callback.status, 302);
  return cookiePair(callback, USER_SESSION_COOKIE);
}

test("portal routes publish their paths", () => {
  assert.equal(homeConfig.path, "/portal-starter/portal");
  assert.equal(loginConfig.path, "/portal-starter/portal/auth/login");
  assert.equal(callbackConfig.path, "/portal-starter/portal/auth/callback");
  assert.equal(logoutConfig.path, "/portal-starter/portal/auth/logout");
});

test("the stub provider says sign-in isn't set up and never admits anyone", async () => {
  const portal = deps({ provider: stubUserProvider });
  const login = await handleUserLogin(request("/portal-starter/portal/auth/login"), portal);
  assert.equal(login.status, 501);
  assert.match(await login.text(), /isn't set up/);
  const callback = await handleUserCallback(request("/portal-starter/portal/auth/callback?code=anything"), portal);
  assert.equal(callback.status, 403);
  assert.equal(callback.headers.getSetCookie().length, 0);
});

test("a missing user session key, or one equal to the staff key, refuses every portal route", async () => {
  for (const env of [{ APP_SESSION_KEY: STAFF_KEY }, { APP_USER_SESSION_KEY: STAFF_KEY, APP_SESSION_KEY: STAFF_KEY }]) {
    const portal = deps({ env });
    assert.equal((await handleUserLogin(request("/portal-starter/portal/auth/login"), portal)).status, 403);
    assert.equal((await handleUserCallback(request("/portal-starter/portal/auth/callback"), portal)).status, 403);
    assert.equal((await handleUserSession(request("/portal-starter/portal"), portal)).status, 403);
  }
});

test("a first sign-in creates an active user and the session opens the portal", async () => {
  const reads: string[] = [];
  const directory = memoryUserDirectory();
  const portal = deps({ directory, reads });
  const callback = await handleUserCallback(request("/portal-starter/portal/auth/callback"), portal);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/portal-starter/portal");
  const cookie = cookiePair(callback, USER_SESSION_COOKIE);
  assert.match(cookie, /^app_user_session=/);
  assert.equal(cookie.includes("ada@example.test"), false);
  const setCookie = callback.headers.getSetCookie()[0] ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  const page = await handleUserSession(request("/portal-starter/portal", cookie), portal);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "portal for Ada Hollow");
  assert.equal(reads.length, 1);
  const again = await handleUserCallback(request("/portal-starter/portal/auth/callback"), portal);
  assert.equal(again.status, 302);
  const found = await directory.findByIdentity(ADA);
  assert.equal(found?.state, "active");
});

test("an invited user becomes active at first sign-in", async () => {
  const directory = memoryUserDirectory([{ id: "invited-1", state: "invited", displayName: "Ada Hollow", email: "ada@example.test", identity: ADA }]);
  const cookie = await signedIn(deps({ directory }));
  assert.notEqual(cookie, "");
  assert.equal((await directory.findById("invited-1"))?.state, "active");
});

test("a suspended user gets no session, and suspension ends an open session", async () => {
  const suspended = memoryUserDirectory([{ id: "suspended-1", state: "suspended", displayName: "June Peck", email: "june@example.test", identity: ADA }]);
  const refused = await handleUserCallback(request("/portal-starter/portal/auth/callback"), deps({ directory: suspended }));
  assert.equal(refused.status, 403);
  assert.equal(refused.headers.getSetCookie().length, 0);

  const reads: string[] = [];
  const directory = memoryUserDirectory();
  const portal = deps({ directory, reads });
  const cookie = await signedIn(portal);
  const user = await directory.findByIdentity(ADA);
  assert.ok(user);
  await directory.setState(user.id, "suspended");
  const ended = await handleUserSession(request("/portal-starter/portal", cookie), portal);
  assert.equal(ended.status, 403);
  assert.match(ended.headers.getSetCookie()[0] ?? "", /^app_user_session=; .*Max-Age=0/);
  assert.deepEqual(reads, []);
});

test("an identity from another provider is refused", async () => {
  const portal = deps({ provider: { ...fakeProvider({ ...ADA, provider: "other" }) } });
  const callback = await handleUserCallback(request("/portal-starter/portal/auth/callback"), portal);
  assert.equal(callback.status, 403);
});

test("a missing, forged, or expired user session is refused before any read", async () => {
  let now = new Date(ISSUED);
  const reads: string[] = [];
  const portal = deps({ clock: () => now, reads });
  const cookie = await signedIn(portal);
  now = new Date(ISSUED.getTime() + SESSION_MS);
  for (const candidate of [undefined, "app_user_session=forged.not-a-signature", cookie]) {
    const page = await handleUserSession(request("/portal-starter/portal", candidate), portal);
    assert.equal(page.status, 403);
  }
  assert.deepEqual(reads, []);
});

test("a staff session never opens the portal", async () => {
  const sameKey = deps({ env: { APP_USER_SESSION_KEY: USER_KEY, APP_SESSION_KEY: USER_KEY } });
  const reads: string[] = [];
  const portal = deps({ reads });
  const userCookie = await signedIn(portal);
  const value = userCookie.slice(userCookie.indexOf("=") + 1);
  const renamed = `app_session=${value}`;
  assert.equal((await handleUserSession(request("/portal-starter/portal", renamed), portal)).status, 403);
  assert.equal((await handleUserSession(request("/portal-starter/portal", userCookie), sameKey)).status, 403);
  assert.deepEqual(reads, []);
});

test("a user session never opens admin, even if its value is replayed as the staff cookie", async () => {
  const portal = deps({ env: { APP_USER_SESSION_KEY: USER_KEY, APP_SESSION_KEY: STAFF_KEY } });
  const userCookie = await signedIn(portal);
  const value = userCookie.slice(userCookie.indexOf("=") + 1);
  let connects = 0;
  const adminEnv = { MODE: "mock", APP_DEPLOY_CONTEXT: "dev", APP_SESSION_KEY: USER_KEY, DATABASE_URL: "postgres://example.test/app" };
  const admin: AdminDeps = {
    env: adminEnv,
    clock: () => ISSUED,
    connect() {
      connects += 1;
      return Promise.reject(new Error("connect called"));
    },
    session: () => ({
      env: adminEnv,
      clock: () => ISSUED,
      directory: memoryStaffDirectory([]),
      audit: { write() { return undefined; } },
      mockIdToken: () => undefined,
      transport: () => Promise.reject(new Error("transport called")),
      readData: () => Promise.resolve(new Response("unread")),
    }),
    readers: {
      users: () => Promise.reject(new Error("read")),
      user: () => Promise.reject(new Error("read")),
      settings: () => Promise.reject(new Error("read")),
    },
  };
  for (const cookie of [userCookie, `app_session=${value}`]) {
    const response = await handleUsers(request("/portal-starter/admin", cookie), admin);
    assert.equal(response.status, 403);
  }
  assert.equal(connects, 0);
});

test("no environment variable grants portal access", async () => {
  const reads: string[] = [];
  const portal = deps({
    env: { APP_USER_SESSION_KEY: USER_KEY, APP_SESSION_KEY: STAFF_KEY, APP_ROLE: "user", APP_PORTAL_USER: "subject-ada", APP_DEV_USER: "1" },
    reads,
  });
  const page = await handleUserSession(request("/portal-starter/portal"), portal);
  assert.equal(page.status, 403);
  assert.deepEqual(reads, []);
});

test("logout clears the user session", () => {
  const response = handleUserLogout();
  assert.equal(response.status, 200);
  assert.match(response.headers.getSetCookie()[0] ?? "", /^app_user_session=; .*Path=\/portal-starter; Max-Age=0/);
});

test("the portal page shows the dev banner outside production only", async () => {
  const user = { id: "u1", state: "active" as const, displayName: "Ada Hollow", email: "ada@example.test" };
  const dev = await portalPage({ APP_DEPLOY_CONTEXT: "dev", APP_DB_LABEL: "preview/pr-9" }, user).text();
  const production = await portalPage({ APP_DEPLOY_CONTEXT: "production" }, user).text();
  assert.match(dev, /DEV\/preview environment\. Test data only\. preview\/pr-9/);
  assert.equal(production.includes("DEV/preview environment"), false);
  assert.match(production, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(production, /Welcome, Ada Hollow/);
});

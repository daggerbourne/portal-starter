import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryAuditSink } from "../../../core/adapter-gate/memory-audit-sink.js";
import type { AuditRow } from "../../../core/adapter-gate/run-adapter.js";
import { entraIds } from "../../../server/auth/config.js";
import {
  handleCallback,
  handleLogin,
  memoryStaffDirectory,
  type AuthDeps,
  type StaffRecord,
} from "../../../server/auth/staff-sign-in.js";
import { productionAuthDeps } from "../../../server/auth/wire.js";

const NOW = "2026-03-08T07:30:00.000Z";
const LOGIN = "http://localhost:8888/portal-starter/auth/login";
const CALLBACK = "http://localhost:8888/portal-starter/auth/callback";
const CODE = "synthetic-code";
const EMAIL = "person@example.test";
const NAME = "Synthetic Person";
const STAFF: StaffRecord = { objectId: "oid-staff", role: "staff" };
const KEPT_ROW: AuditRow = {
  adapter: "entra",
  mode: "mock",
  context: "dev",
  outcome: "allowed",
  time: NOW,
};

function unsignedIdToken(claims: { readonly [key: string]: unknown }): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.unsigned`;
}

function cookiePair(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return header?.split(";")[0] ?? "";
}

async function signIn(env: { readonly [name: string]: string | undefined }): Promise<{
  readonly callback: Response;
  readonly rows: readonly AuditRow[];
  readonly networkCalls: number;
  readonly idToken: string;
}> {
  const sink = createMemoryAuditSink();
  const wired = productionAuthDeps({ audit: sink });
  const tokens = new Map<string, string>();
  let networkCalls = 0;
  const deps: AuthDeps = {
    ...wired,
    env: {
      MODE: "mock",
      APP_DEPLOY_CONTEXT: "dev",
      APP_SESSION_KEY: "synthetic-session-key",
      ...env,
    },
    clock: () => new Date(NOW),
    directory: memoryStaffDirectory([STAFF]),
    mockIdToken: (code) => tokens.get(code),
    transport: () => {
      networkCalls += 1;
      return Promise.reject(new Error("network"));
    },
  };
  const login = handleLogin(new Request(LOGIN), deps);
  const location = new URL(login.headers.get("location") ?? "http://invalid.example/");
  const ids = entraIds(deps.env);
  const idToken = unsignedIdToken({
    iss: `https://login.microsoftonline.com/${ids.tenantId}/v2.0`,
    aud: ids.clientId,
    exp: Math.floor(deps.clock().getTime() / 1000) + 3600,
    nonce: location.searchParams.get("nonce"),
    oid: STAFF.objectId,
    email: EMAIL,
    name: NAME,
    roles: ["PortalStarter.Staff"],
  });
  tokens.set(CODE, idToken);
  const callback = await handleCallback(
    new Request(
      `${CALLBACK}?code=${encodeURIComponent(CODE)}&state=${encodeURIComponent(location.searchParams.get("state") ?? "")}`,
      { headers: { cookie: cookiePair(login, "app_login") } },
    ),
    deps,
  );
  return { callback, rows: sink.rows(), networkCalls, idToken };
}

function assertNoPersonalData(rows: readonly AuditRow[], idToken: string): void {
  const packed = JSON.stringify(rows);
  assert.equal(packed.includes(EMAIL), false);
  assert.equal(packed.includes(NAME), false);
  assert.equal(packed.includes(CODE), false);
  assert.equal(packed.includes(idToken), false);
}

test("one staff sign-in writes one audit row with no personal data", async () => {
  const result = await signIn({});
  assert.equal(result.callback.status, 302);
  assert.equal(result.callback.headers.get("location"), "/portal-starter/admin");
  assert.equal(result.networkCalls, 0);
  assert.deepEqual(result.rows, [KEPT_ROW]);
  assertNoPersonalData(result.rows, result.idToken);
});

test("APP_KILL blocks the token call and writes one audit row", async () => {
  const result = await signIn({ APP_KILL: "1" });
  assert.equal(result.callback.status, 403);
  assert.equal(result.networkCalls, 0);
  assert.equal(cookiePair(result.callback, "app_session"), "");
  assert.deepEqual(result.rows, [
    {
      adapter: "entra",
      mode: "mock",
      context: "dev",
      outcome: "killed",
      time: NOW,
    },
  ]);
  assertNoPersonalData(result.rows, result.idToken);
});

test("MODE=mock makes no network call", async () => {
  const result = await signIn({ MODE: "mock" });
  assert.equal(result.callback.status, 302);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.outcome, "allowed");
});

test("production sign-in does not keep audit rows in memory", () => {
  const source = readFileSync(new URL("../../../server/auth/wire.ts", import.meta.url), "utf8");
  assert.equal(source.includes("memory-audit-sink"), false);
  assert.equal(source.includes("postgres-audit-sink"), true);
});

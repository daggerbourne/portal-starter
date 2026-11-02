import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_KEY_NAMES, startupRefusal, type StartupEnv } from "../../../core/startup-guard/startup-guard.js";

const BODY = "Portal Starter cannot start in this deploy context.";
const PROD_HOST = "prod-db.example.test";
const DEV_HOST = "dev-db.example.test";
const SECRET = "synthetic-secret";

function urlFor(host: string): string {
  return `postgres://app:${SECRET}@${host}/neondb`;
}

function preview(extra: StartupEnv = {}): StartupEnv {
  return {
    MODE: "mock",
    APP_DEPLOY_CONTEXT: "dev",
    APP_PROD_DB_HOST: PROD_HOST,
    DATABASE_URL: urlFor(DEV_HOST),
    ...extra,
  };
}

async function refused(env: StartupEnv, names?: readonly string[]): Promise<Response> {
  const response = startupRefusal(env, names);
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), BODY);
  return response;
}

test("a production database host outside production refuses", async () => {
  await refused(preview({ DATABASE_URL: urlFor(PROD_HOST) }));
  await refused(preview({ DATABASE_URL: `postgres://app:${SECRET}@${PROD_HOST}:5432/neondb` }));
});

test("a production database host with the pooler suffix refuses", async () => {
  await refused(preview({ DATABASE_URL: urlFor("prod-db-pooler.example.test") }));
  await refused(preview({
    APP_PROD_DB_HOST: "prod-db-pooler.example.test",
    DATABASE_URL: urlFor(PROD_HOST),
  }));
});

test("a production database host in upper case refuses", async () => {
  await refused(preview({ DATABASE_URL: urlFor("PROD-DB.EXAMPLE.TEST") }));
  await refused(preview({
    APP_PROD_DB_HOST: "PROD-DB-POOLER.EXAMPLE.TEST",
    DATABASE_URL: urlFor(PROD_HOST),
  }));
});

test("a production database host with a trailing dot refuses", async () => {
  await refused(preview({ DATABASE_URL: urlFor(`${PROD_HOST}.`) }));
  await refused(preview({
    APP_PROD_DB_HOST: `${PROD_HOST}.`,
    DATABASE_URL: urlFor(PROD_HOST),
  }));
});

test("MODE=live outside production refuses", async () => {
  await refused(preview({ MODE: " live " }));
  await refused(preview({ APP_DEPLOY_CONTEXT: "Production", MODE: "live" }));
});

test("a missing deploy context refuses", async () => {
  await refused(preview({ APP_DEPLOY_CONTEXT: undefined }));
  await refused(preview({ APP_DEPLOY_CONTEXT: "" }));
  await refused(preview({ APP_DEPLOY_CONTEXT: "   " }));
});

test("a missing production database host outside production refuses", async () => {
  await refused(preview({ APP_PROD_DB_HOST: undefined }));
  await refused(preview({ APP_PROD_DB_HOST: "   " }));
});

test("an unparseable database url outside production refuses", async () => {
  await refused(preview({ DATABASE_URL: "not a url" }));
  await refused(preview({ DATABASE_URL: "postgres:///" }));
});

test("production with the production database host is allowed", () => {
  assert.equal(startupRefusal({
    MODE: "live",
    APP_DEPLOY_CONTEXT: " production ",
    APP_PROD_DB_HOST: PROD_HOST,
    DATABASE_URL: urlFor("prod-db-pooler.example.test"),
    APP_FUTURE_LIVE_KEY: "present",
  }, ["APP_FUTURE_LIVE_KEY"]), undefined);
});

test("a preview with the dev database host is allowed", () => {
  assert.equal(startupRefusal(preview()), undefined);
  assert.equal(startupRefusal(preview({ APP_DEPLOY_CONTEXT: "deploy-preview" })), undefined);
});

test("a missing database url is allowed outside production", () => {
  assert.equal(startupRefusal(preview({ DATABASE_URL: undefined })), undefined);
  assert.equal(startupRefusal(preview({ DATABASE_URL: "   " })), undefined);
});

test("a different host that only shares a suffix is allowed", () => {
  assert.equal(startupRefusal(preview({ DATABASE_URL: urlFor("not-prod-db.example.test") })), undefined);
  assert.equal(startupRefusal(preview({ DATABASE_URL: urlFor("other-pooler.example.test") })), undefined);
});

test("a name on the live-key list refuses when it is set", async () => {
  const names = ["APP_FUTURE_LIVE_KEY"];
  await refused(preview({ APP_FUTURE_LIVE_KEY: "present" }), names);
  assert.equal(startupRefusal(preview({ APP_FUTURE_LIVE_KEY: "  " }), names), undefined);
  assert.equal(startupRefusal(preview({}), names), undefined);
});

test("the exported live-key list is the list the guard reads", async () => {
  assert.equal(LIVE_KEY_NAMES.every((name) => name.trim() === name && name.length > 0), true);
  for (const name of LIVE_KEY_NAMES) {
    await refused(preview({ [name]: "present" }));
  }
});

function urlWithHostQuery(queryHost: string, authorityHost: string = DEV_HOST): string {
  return `postgres://app:${SECRET}@${authorityHost}/neondb?host=${encodeURIComponent(queryHost)}`;
}

test("a query host that is the production database host refuses", async () => {
  await refused(preview({ DATABASE_URL: urlWithHostQuery(PROD_HOST) }));
  await refused(preview({ DATABASE_URL: urlWithHostQuery(`${PROD_HOST}.`) }));
  await refused(preview({ DATABASE_URL: urlWithHostQuery(` ${PROD_HOST} `) }));
  await refused(preview({ DATABASE_URL: `postgres://app:${SECRET}@${PROD_HOST}/neondb?host=` }));
});

test("a query host list refuses when any entry is the production database host", async () => {
  await refused(preview({ DATABASE_URL: urlWithHostQuery(`${DEV_HOST},${PROD_HOST}`) }));
  await refused(preview({ DATABASE_URL: urlWithHostQuery(`${DEV_HOST}, ${PROD_HOST}`) }));
  await refused(preview({ DATABASE_URL: urlWithHostQuery(`${PROD_HOST},${DEV_HOST}`) }));
  await refused(preview({ DATABASE_URL: `postgres://app:${SECRET}@${DEV_HOST},${PROD_HOST}/neondb` }));
});

test("a query host with the pooler suffix refuses", async () => {
  await refused(preview({ DATABASE_URL: urlWithHostQuery("prod-db-pooler.example.test") }));
  await refused(preview({
    APP_PROD_DB_HOST: "prod-db-pooler.example.test",
    DATABASE_URL: urlWithHostQuery(PROD_HOST),
  }));
});

test("a query host in upper case refuses", async () => {
  await refused(preview({ DATABASE_URL: urlWithHostQuery("PROD-DB.EXAMPLE.TEST") }));
  await refused(preview({
    APP_PROD_DB_HOST: "PROD-DB-POOLER.EXAMPLE.TEST",
    DATABASE_URL: urlWithHostQuery(PROD_HOST),
  }));
});

test("a dev query host is allowed outside production", () => {
  assert.equal(startupRefusal(preview({ DATABASE_URL: urlWithHostQuery(DEV_HOST) })), undefined);
  assert.equal(startupRefusal(preview({ DATABASE_URL: urlWithHostQuery(DEV_HOST, PROD_HOST) })), undefined);
  assert.equal(startupRefusal(preview({ DATABASE_URL: `postgres://app:${SECRET}@${DEV_HOST}/neondb?host=` })), undefined);
  assert.equal(startupRefusal(preview({
    DATABASE_URL: `postgres://app:${SECRET}@${DEV_HOST}/neondb?host=${encodeURIComponent(PROD_HOST)}&host=${encodeURIComponent(DEV_HOST)}`,
  })), undefined);
});

test("a socket query host is allowed outside production", () => {
  assert.equal(startupRefusal(preview({
    DATABASE_URL: urlWithHostQuery("/var/run/postgresql", PROD_HOST),
  })), undefined);
  assert.equal(startupRefusal(preview({
    DATABASE_URL: urlWithHostQuery(`/tmp/pg.sock,${PROD_HOST}`, PROD_HOST),
  })), undefined);
});

test("a whitespace query host is allowed outside production", () => {
  assert.equal(startupRefusal(preview({
    DATABASE_URL: urlWithHostQuery("  ", PROD_HOST),
  })), undefined);
});

test("a later query host that is the production database host refuses", async () => {
  await refused(preview({
    DATABASE_URL: `postgres://app:${SECRET}@${DEV_HOST}/neondb?host=${encodeURIComponent(DEV_HOST)}&host=${encodeURIComponent(PROD_HOST)}`,
  }));
});

test("production with a query host is allowed", () => {
  const production: StartupEnv = {
    MODE: "live",
    APP_DEPLOY_CONTEXT: "production",
    APP_PROD_DB_HOST: PROD_HOST,
  };
  assert.equal(startupRefusal({ ...production, DATABASE_URL: urlWithHostQuery(PROD_HOST) }), undefined);
  assert.equal(startupRefusal({ ...production, DATABASE_URL: urlWithHostQuery(`${DEV_HOST},${PROD_HOST}`) }), undefined);
  assert.equal(startupRefusal({ ...production, DATABASE_URL: urlWithHostQuery("prod-db-pooler.example.test") }), undefined);
  assert.equal(startupRefusal({ ...production, DATABASE_URL: urlWithHostQuery("PROD-DB.EXAMPLE.TEST") }), undefined);
  assert.equal(startupRefusal({ ...production, DATABASE_URL: urlWithHostQuery("/var/run/postgresql", PROD_HOST) }), undefined);
});

test("the refusal body names no environment value", async () => {
  const sentinels = [SECRET, PROD_HOST, "sentinel-user", "sentinel-password", "sentinel-key-value", "deploy-preview"];
  const response = startupRefusal(preview({
    APP_DEPLOY_CONTEXT: "deploy-preview",
    MODE: "live",
    DATABASE_URL: "postgres://sentinel-user:sentinel-password@prod-db.example.test/neondb",
    APP_FUTURE_LIVE_KEY: "sentinel-key-value",
  }), ["APP_FUTURE_LIVE_KEY"]);
  assert.ok(response);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body, BODY);
  for (const sentinel of sentinels) assert.equal(body.includes(sentinel), false, sentinel);
  for (const [header, headerValue] of response.headers) {
    for (const sentinel of sentinels) assert.equal(headerValue.includes(sentinel), false, header);
  }
});

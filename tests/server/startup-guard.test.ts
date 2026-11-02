import assert from "node:assert/strict";
import { globSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { test } from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";

const BODY = "Portal Starter cannot start in this deploy context.";
const SENTINELS = [
  "sentinel-user",
  "sentinel-password",
  "sentinel-prod.example.test",
  "sentinel-key-value",
  "sentinel-db",
];
const ENV_NAMES = ["MODE", "APP_DEPLOY_CONTEXT", "APP_PROD_DB_HOST", "DATABASE_URL", "APP_FUTURE_LIVE_KEY"] as const;
const root = fileURLToPath(new URL("../..", import.meta.url));

type AsyncCall = (this: unknown, ...args: unknown[]) => Promise<unknown>;

function recordDatabase(calls: string[]): () => void {
  const prototype = Client.prototype as { connect: AsyncCall; query: AsyncCall; end: AsyncCall };
  const connect = prototype.connect;
  const query = prototype.query;
  const end = prototype.end;
  prototype.connect = function rejectedConnect() {
    calls.push("connect");
    return Promise.reject(new Error("database read"));
  };
  prototype.query = function rejectedQuery() {
    calls.push("query");
    return Promise.reject(new Error("database read"));
  };
  prototype.end = function rejectedEnd() {
    calls.push("end");
    return Promise.resolve();
  };
  return () => {
    prototype.connect = connect;
    prototype.query = query;
    prototype.end = end;
  };
}

function functionFiles(): string[] {
  return globSync("server/functions/**/*.{ts,mjs,js,cjs,mts,cts}", { cwd: root })
    .filter((file) => !/\.d\.[cm]?ts$/.test(file))
    .sort();
}

function isHandler(value: unknown): value is (request: Request) => Response | Promise<Response> {
  return typeof value === "function";
}

test("every server function refuses when the startup guard is tripped and reads no database", async () => {
  const calls: string[] = [];
  const restoreDatabase = recordDatabase(calls);
  const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  delete process.env.APP_DEPLOY_CONTEXT;
  process.env.MODE = "live";
  process.env.APP_PROD_DB_HOST = "sentinel-prod.example.test";
  process.env.DATABASE_URL = "postgres://sentinel-user:sentinel-password@sentinel-prod.example.test/sentinel-db";
  process.env.APP_FUTURE_LIVE_KEY = "sentinel-key-value";
  try {
    const files = functionFiles();
    assert.ok(files.length > 0);
    for (const file of files) {
      const imported: { default?: unknown } = await import(pathToFileURL(path.join(root, file)).href);
      const handler = imported.default;
      if (!isHandler(handler)) throw new Error(file);
      const response = await handler(new Request("http://localhost/portal-starter/"));
      const body = await response.text();
      assert.equal(response.status, 503, file);
      assert.equal(body, BODY, file);
      for (const sentinel of SENTINELS) {
        assert.equal(body.includes(sentinel), false, `${file} ${sentinel}`);
        for (const [header, headerValue] of response.headers.entries()) {
          assert.equal(headerValue.includes(sentinel), false, `${file} ${header}`);
        }
      }
      assert.deepEqual(calls, [], file);
    }
  } finally {
    restoreDatabase();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

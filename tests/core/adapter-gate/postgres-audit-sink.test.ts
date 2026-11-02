import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresAuditSink } from "../../../core/adapter-gate/postgres-audit-sink.js";
import { runAdapter, type AuditRow } from "../../../core/adapter-gate/run-adapter.js";

const TIME = "2026-03-08T08:30:00.000Z";
const EMAIL = "person@example.test";
const CODE = "synthetic-code";
const TOKEN = "header.payload.unsigned";
const OID = "oid-person";
const HOSTILE = "'); DROP TABLE audit;--";
const ROW: AuditRow = {
  adapter: HOSTILE,
  mode: "mock",
  context: "dev",
  outcome: "allowed",
  time: TIME,
};

type Seen = { text: string; values: readonly unknown[] };

function capture(rows: readonly unknown[] | Error, url: string | undefined) {
  const seen: Seen[] = [];
  let connects = 0;
  const sink = createPostgresAuditSink({
    databaseUrl: () => url,
    connect() {
      connects += 1;
      return Promise.resolve({
        query(text, values) {
          seen.push({ text, values: [...values] });
          if (rows instanceof Error) return Promise.reject(rows);
          return Promise.resolve({ rows });
        },
        end() {
          return Promise.resolve();
        },
      });
    },
  });
  return { sink, seen, connects: () => connects };
}

function assertNoPersonalData(seen: readonly Seen[]): void {
  const packed = JSON.stringify(seen);
  assert.equal(packed.includes(EMAIL), false);
  assert.equal(packed.includes(CODE), false);
  assert.equal(packed.includes(TOKEN), false);
  assert.equal(packed.includes(OID), false);
}

test("one gate call inserts one audit row with bind values and no personal data", async () => {
  const probe = capture([], "postgres://example.test/portal-starter");
  const value = await runAdapter("entra", () => "token-call", {
    env: (name) => (name === "MODE" ? "mock" : name === "APP_DEPLOY_CONTEXT" ? "dev" : undefined),
    clock: () => new Date(TIME),
    audit: probe.sink,
  });
  assert.equal(value, "token-call");
  assert.equal(probe.connects(), 1);
  assert.equal(probe.seen.length, 1);
  const query = probe.seen[0];
  assert.ok(query);
  assert.match(query.text, /INSERT INTO audit \(adapter, mode, context, outcome, occurred_at, created_by\)/);
  assert.equal(query.text.includes("$1"), true);
  assert.deepEqual(query.values, ["entra", "mock", "dev", "allowed", TIME, "system:adapter-gate"]);
  assertNoPersonalData(probe.seen);
  await probe.sink.write(ROW);
  assert.equal(probe.connects(), 2);
  const bound = probe.seen[1];
  assert.ok(bound);
  assert.equal(bound.text.includes(HOSTILE), false);
  assert.deepEqual(bound.values, [HOSTILE, "mock", "dev", "allowed", TIME, "system:adapter-gate"]);
  assertNoPersonalData(probe.seen);
});

test("a thrown insert rejects the gate call", async () => {
  const probe = capture(new Error("insert failed"), "postgres://example.test/portal-starter");
  await assert.rejects(
    () =>
      runAdapter("entra", () => "token-call", {
        env: (name) => (name === "MODE" ? "mock" : name === "APP_DEPLOY_CONTEXT" ? "dev" : undefined),
        clock: () => new Date(TIME),
        audit: probe.sink,
      }),
    (error: unknown) => error instanceof Error && error.message === "insert failed",
  );
  assert.equal(probe.connects(), 1);
});

test("a missing database url rejects the gate call and does not connect", async () => {
  for (const url of [undefined, "", "   "]) {
    const probe = capture([ROW], url);
    await assert.rejects(() =>
      runAdapter("entra", () => "token-call", {
        env: (name) => (name === "MODE" ? "mock" : name === "APP_DEPLOY_CONTEXT" ? "dev" : undefined),
        clock: () => new Date(TIME),
        audit: probe.sink,
      }),
    );
    assert.equal(probe.connects(), 0, String(url));
    assert.deepEqual(probe.seen, []);
  }
});

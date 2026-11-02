import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAuditSink } from "../../../core/adapter-gate/memory-audit-sink.js";
import {
  AdapterRefusal,
  runAdapter,
  type EnvName,
} from "../../../core/adapter-gate/run-adapter.js";

const FIXED_TIME = "2026-03-08T08:30:00.000Z";

test("APP_KILL of 1 stops the adapter and writes one audit row", async () => {
  const sink = createMemoryAuditSink();
  let calls = 0;
  const env: Record<EnvName, string> = {
    MODE: "mock",
    APP_KILL: "1",
    APP_DEPLOY_CONTEXT: "production",
  };
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return "sent";
        },
        {
          env: (name) => env[name],
          clock: () => new Date(FIXED_TIME),
          audit: sink,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AdapterRefusal);
      assert.equal(error.outcome, "killed");
      assert.equal(error.message, "APP_KILL is 1.");
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(sink.rows().length, 1);
  assert.equal(sink.rows()[0]?.outcome, "killed");
  assert.equal(sink.rows()[0]?.time, FIXED_TIME);
  assert.equal(sink.rows()[0]?.adapter, "catalog");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAuditSink } from "../../../core/adapter-gate/memory-audit-sink.js";
import {
  AdapterRefusal,
  runAdapter,
  type AdapterDeps,
  type AuditRow,
  type AuditSink,
  type EnvName,
  type EnvReader,
  type Mode,
} from "../../../core/adapter-gate/run-adapter.js";

const FIXED_TIME = "2026-03-08T08:30:00.000Z";
const FALLBACK_TIME = "2026-11-01T07:30:00.000Z";
const ROW_KEYS = ["adapter", "context", "mode", "outcome", "time"];

const CONTEXTS = ["production", "dev", "staging"] as const;

function envFrom(record: Partial<Record<EnvName, string>>): EnvReader {
  return (name) => record[name];
}

function harness(
  record: Partial<Record<EnvName, string>>,
  instant = FIXED_TIME,
): {
  deps: AdapterDeps;
  sink: ReturnType<typeof createMemoryAuditSink>;
  ticks: () => number;
} {
  const sink = createMemoryAuditSink();
  let ticks = 0;
  const deps: AdapterDeps = {
    env: envFrom(record),
    clock: () => {
      ticks += 1;
      return new Date(instant);
    },
    audit: sink,
  };
  return { deps, sink, ticks: () => ticks };
}

function onlyRow(sink: ReturnType<typeof createMemoryAuditSink>): AuditRow {
  const rows = sink.rows();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  return row;
}

test("mock and sandbox run in production, dev, and staging", async () => {
  const modes = ["mock", "sandbox"] as const;
  for (const mode of modes) {
    for (const context of CONTEXTS) {
      const { deps, sink, ticks } = harness({
        MODE: mode,
        APP_DEPLOY_CONTEXT: context,
      });
      let calls = 0;
      const value = { mode, context };
      let seen: Mode | undefined;
      const result = await runAdapter(
        "catalog",
        (parsed) => {
          calls += 1;
          seen = parsed;
          return value;
        },
        deps,
      );
      assert.equal(calls, 1);
      assert.equal(seen, mode);
      assert.equal(result, value);
      assert.equal(ticks(), 1);
      const row = onlyRow(sink);
      assert.equal(row.adapter, "catalog");
      assert.equal(row.mode, mode);
      assert.equal(row.context, context);
      assert.equal(row.outcome, "allowed");
      assert.equal(row.time, FIXED_TIME);
    }
  }
});

test("live runs only in production", async () => {
  for (const context of CONTEXTS) {
    const { deps, sink, ticks } = harness({
      MODE: "live",
      APP_DEPLOY_CONTEXT: context,
    });
    let calls = 0;
    const value = { live: context };
    if (context === "production") {
      const result = await runAdapter(
        "catalog",
        (parsed) => {
          calls += 1;
          assert.equal(parsed, "live");
          return value;
        },
        deps,
      );
      assert.equal(calls, 1);
      assert.equal(result, value);
      assert.equal(ticks(), 1);
      const row = onlyRow(sink);
      assert.equal(row.mode, "live");
      assert.equal(row.context, "production");
      assert.equal(row.outcome, "allowed");
      assert.equal(row.time, FIXED_TIME);
      continue;
    }
    await assert.rejects(
      () =>
        runAdapter(
          "catalog",
          () => {
            calls += 1;
            return value;
          },
          deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdapterRefusal);
        assert.equal(error.outcome, "live_refused");
        return true;
      },
    );
    assert.equal(calls, 0);
    assert.equal(ticks(), 1);
    const row = onlyRow(sink);
    assert.equal(row.mode, "live");
    assert.equal(row.context, context);
    assert.equal(row.outcome, "live_refused");
    assert.equal(row.time, FIXED_TIME);
  }
});

test("missing deploy context refuses mock", async () => {
  const records: readonly Partial<Record<EnvName, string>>[] = [
    { MODE: "mock" },
    { MODE: "mock", APP_DEPLOY_CONTEXT: "" },
    { MODE: "mock", APP_DEPLOY_CONTEXT: "   " },
  ];
  for (const record of records) {
    const { deps, sink, ticks } = harness(record);
    let calls = 0;
    await assert.rejects(
      () =>
        runAdapter(
          "catalog",
          () => {
            calls += 1;
            return "called";
          },
          deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdapterRefusal);
        assert.equal(error.outcome, "missing_context");
        return true;
      },
    );
    assert.equal(calls, 0);
    assert.equal(ticks(), 1);
    const row = onlyRow(sink);
    assert.equal(row.mode, "mock");
    assert.equal(row.context, "");
    assert.equal(row.outcome, "missing_context");
  }
});

test("an unrecognized MODE is invalid and the raw string is not stored", async () => {
  const rawModes: readonly (string | undefined)[] = [
    undefined,
    "",
    "LIVE",
    "sk-live-secret",
  ];
  for (const rawMode of rawModes) {
    const record: Partial<Record<EnvName, string>> = {
      APP_DEPLOY_CONTEXT: "production",
    };
    if (rawMode !== undefined) {
      record.MODE = rawMode;
    }
    const { deps, sink, ticks } = harness(record);
    let calls = 0;
    await assert.rejects(
      () =>
        runAdapter(
          "catalog",
          () => {
            calls += 1;
            return "called";
          },
          deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdapterRefusal);
        assert.equal(error.outcome, "invalid_mode");
        return true;
      },
    );
    assert.equal(calls, 0);
    assert.equal(ticks(), 1);
    const row = onlyRow(sink);
    assert.equal(row.mode, "invalid");
    assert.equal(row.context, "production");
    assert.equal(row.outcome, "invalid_mode");
    assert.equal(JSON.stringify(row).includes("sk-live-secret"), false);
  }
});

test("APP_KILL of 1 blocks a live production call", async () => {
  for (const kill of ["1", " 1 ", "1\n"]) {
    const { deps, sink, ticks } = harness({
      MODE: "live",
      APP_KILL: kill,
      APP_DEPLOY_CONTEXT: "production",
    });
    let calls = 0;
    await assert.rejects(
      () =>
        runAdapter(
          "billing",
          () => {
            calls += 1;
            return "called";
          },
          deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdapterRefusal);
        assert.equal(error.adapter, "billing");
        assert.equal(error.outcome, "killed");
        return true;
      },
    );
    assert.equal(calls, 0);
    assert.equal(ticks(), 1);
    const row = onlyRow(sink);
    assert.equal(row.adapter, "billing");
    assert.equal(row.mode, "live");
    assert.equal(row.context, "production");
    assert.equal(row.outcome, "killed");
  }
});

test("other APP_KILL values do not block mock in production", async () => {
  const kills: readonly (string | undefined)[] = ["0", "01", "true", undefined];
  for (const kill of kills) {
    const record: Partial<Record<EnvName, string>> = {
      MODE: "mock",
      APP_DEPLOY_CONTEXT: "production",
    };
    if (kill !== undefined) {
      record.APP_KILL = kill;
    }
    const { deps, sink, ticks } = harness(record);
    let calls = 0;
    const result = await runAdapter(
      "catalog",
      () => {
        calls += 1;
        return "kept";
      },
      deps,
    );
    assert.equal(calls, 1);
    assert.equal(result, "kept");
    assert.equal(ticks(), 1);
    const row = onlyRow(sink);
    assert.equal(row.mode, "mock");
    assert.equal(row.outcome, "allowed");
  }
});

test("kill wins over a missing context and an invalid mode", async () => {
  const { deps, sink, ticks } = harness({
    MODE: "sk-live-secret",
    APP_KILL: "1",
  });
  let calls = 0;
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return "called";
        },
        deps,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AdapterRefusal);
      assert.equal(error.outcome, "killed");
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(ticks(), 1);
  const row = onlyRow(sink);
  assert.equal(row.mode, "invalid");
  assert.equal(row.context, "");
  assert.equal(row.outcome, "killed");
  assert.equal(JSON.stringify(row).includes("sk-live-secret"), false);
});

test("missing context wins over an invalid mode", async () => {
  const { deps, sink, ticks } = harness({ MODE: "LIVE" });
  let calls = 0;
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return "called";
        },
        deps,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AdapterRefusal);
      assert.equal(error.outcome, "missing_context");
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(ticks(), 1);
  const row = onlyRow(sink);
  assert.equal(row.mode, "invalid");
  assert.equal(row.context, "");
  assert.equal(row.outcome, "missing_context");
});

test("trimmed production and live allow the call", async () => {
  const { deps, sink, ticks } = harness({
    MODE: " live ",
    APP_DEPLOY_CONTEXT: " production ",
  });
  let calls = 0;
  let seen: Mode | undefined;
  const result = await runAdapter(
    "catalog",
    (parsed) => {
      calls += 1;
      seen = parsed;
      return "opened";
    },
    deps,
  );
  assert.equal(calls, 1);
  assert.equal(seen, "live");
  assert.equal(result, "opened");
  assert.equal(ticks(), 1);
  const row = onlyRow(sink);
  assert.equal(row.mode, "live");
  assert.equal(row.context, "production");
  assert.equal(row.outcome, "allowed");
});

test("an allowed return value is the same object", async () => {
  const { deps, ticks } = harness({
    MODE: "sandbox",
    APP_DEPLOY_CONTEXT: "staging",
  });
  const value = { id: "same" };
  let calls = 0;
  const result = await runAdapter(
    "catalog",
    (parsed) => {
      calls += 1;
      assert.equal(parsed, "sandbox");
      return value;
    },
    deps,
  );
  assert.equal(calls, 1);
  assert.equal(result, value);
  assert.equal(ticks(), 1);
});

test("two allowed calls append two rows", async () => {
  const sink = createMemoryAuditSink();
  let ticks = 0;
  const deps: AdapterDeps = {
    env: envFrom({ MODE: "mock", APP_DEPLOY_CONTEXT: "dev" }),
    clock: () => {
      ticks += 1;
      return new Date(FIXED_TIME);
    },
    audit: sink,
  };
  let calls = 0;
  const first = { n: 1 };
  const second = { n: 2 };
  const firstResult = await runAdapter(
    "catalog",
    () => {
      calls += 1;
      return first;
    },
    deps,
  );
  const secondResult = await runAdapter(
    "catalog",
    () => {
      calls += 1;
      return second;
    },
    deps,
  );
  assert.equal(firstResult, first);
  assert.equal(secondResult, second);
  assert.equal(calls, 2);
  assert.equal(ticks, 2);
  const rows = sink.rows();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0], rows[1]);
  assert.equal(rows[0]?.outcome, "allowed");
  assert.equal(rows[1]?.outcome, "allowed");
  assert.equal(rows[0]?.time, FIXED_TIME);
  assert.equal(rows[1]?.time, FIXED_TIME);
  assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), ROW_KEYS);
  assert.deepEqual(Object.keys(rows[1] ?? {}).sort(), ROW_KEYS);
});

test("the row keeps the UTC instant across the Chicago fall-back", async () => {
  const { deps, sink, ticks } = harness(
    { MODE: "mock", APP_DEPLOY_CONTEXT: "production" },
    FALLBACK_TIME,
  );
  let calls = 0;
  let clockAlreadyRead = false;
  const result = await runAdapter(
    "catalog",
    () => {
      calls += 1;
      clockAlreadyRead = ticks() === 1;
      return "ok";
    },
    deps,
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.equal(clockAlreadyRead, true);
  assert.equal(ticks(), 1);
  const row = onlyRow(sink);
  assert.equal(row.outcome, "allowed");
  assert.equal(row.time, FALLBACK_TIME);
});

test("a thrown error is rethrown and stays out of the row", async () => {
  const { deps, sink, ticks } = harness({
    MODE: "mock",
    APP_DEPLOY_CONTEXT: "dev",
  });
  const failure = new Error("adapter blew up");
  let calls = 0;
  await assert.rejects(
    () =>
      runAdapter(
        "mail",
        () => {
          calls += 1;
          throw failure;
        },
        deps,
      ),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(ticks(), 1);
  const row = onlyRow(sink);
  assert.equal(row.adapter, "mail");
  assert.equal(row.mode, "mock");
  assert.equal(row.context, "dev");
  assert.equal(row.outcome, "adapter_error");
  assert.equal(JSON.stringify(row).includes(failure.message), false);
});

test("a refusal write error propagates and the adapter is not called", async () => {
  const writeFailure = new Error("audit write failed");
  let writes = 0;
  let calls = 0;
  const audit: AuditSink = {
    write(): Promise<void> {
      writes += 1;
      return Promise.reject(writeFailure);
    },
  };
  const env = envFrom({
    MODE: "live",
    APP_KILL: "1",
    APP_DEPLOY_CONTEXT: "production",
  });
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return "called";
        },
        { env, clock: () => new Date(FIXED_TIME), audit },
      ),
    (error: unknown) => {
      assert.equal(error, writeFailure);
      assert.equal(error instanceof AdapterRefusal, false);
      return true;
    },
  );
  assert.equal(calls, 0);
  assert.equal(writes, 1);
});

test("an allowed write error propagates", async () => {
  const writeFailure = new Error("audit write failed");
  let writes = 0;
  let calls = 0;
  const audit: AuditSink = {
    write(): Promise<void> {
      writes += 1;
      return Promise.reject(writeFailure);
    },
  };
  const env = envFrom({ MODE: "mock", APP_DEPLOY_CONTEXT: "production" });
  const value = { id: "hidden" };
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return value;
        },
        { env, clock: () => new Date(FIXED_TIME), audit },
      ),
    (error: unknown) => {
      assert.equal(error, writeFailure);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(writes, 1);
});

test("an adapter error survives a failed audit write", async () => {
  const failure = new Error("adapter blew up");
  const writeFailure = new Error("audit write failed");
  let writes = 0;
  let calls = 0;
  const audit: AuditSink = {
    write(): Promise<void> {
      writes += 1;
      return Promise.reject(writeFailure);
    },
  };
  const env = envFrom({ MODE: "sandbox", APP_DEPLOY_CONTEXT: "staging" });
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          throw failure;
        },
        { env, clock: () => new Date(FIXED_TIME), audit },
      ),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(writes, 1);
});

test("the allowed row is written after the adapter resolves", async () => {
  const { deps, sink, ticks } = harness({
    MODE: "sandbox",
    APP_DEPLOY_CONTEXT: "production",
  });
  let release: (value: string) => void = () => {
    throw new Error("missing release");
  };
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const running = runAdapter(
    "catalog",
    (parsed) => {
      calls += 1;
      assert.equal(parsed, "sandbox");
      return pending;
    },
    deps,
  );
  assert.equal(calls, 1);
  assert.equal(ticks(), 1);
  assert.equal(sink.rows().length, 0);
  release("done");
  assert.equal(await running, "done");
  const row = onlyRow(sink);
  assert.equal(row.outcome, "allowed");
  assert.equal(row.mode, "sandbox");
  assert.equal(row.time, FIXED_TIME);
});

test("a non-string env value counts as unset", async () => {
  const sink = createMemoryAuditSink();
  let calls = 0;
  const values: Record<EnvName, unknown> = {
    MODE: 2,
    APP_KILL: 1,
    APP_DEPLOY_CONTEXT: 0,
  };
  const env: EnvReader = (name) => values[name];
  await assert.rejects(
    () =>
      runAdapter(
        "catalog",
        () => {
          calls += 1;
          return "called";
        },
        {
          env,
          clock: () => new Date(FIXED_TIME),
          audit: sink,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AdapterRefusal);
      assert.equal(error.outcome, "missing_context");
      return true;
    },
  );
  assert.equal(calls, 0);
  const row = onlyRow(sink);
  assert.equal(row.mode, "invalid");
  assert.equal(row.context, "");
  assert.equal(row.outcome, "missing_context");
});

test("the memory sink keeps insertion order and copies each row", () => {
  const sink = createMemoryAuditSink();
  const first = {
    adapter: "catalog",
    mode: "mock" as const,
    context: "production",
    outcome: "allowed" as const,
    time: FIXED_TIME,
    secret: "person@example.test",
  };
  const second = {
    adapter: "mail",
    mode: "sandbox" as const,
    context: "dev",
    outcome: "allowed" as const,
    time: FALLBACK_TIME,
  };
  sink.write(first);
  sink.write(first);
  sink.write(second);
  first.adapter = "changed";
  const listed = sink.rows();
  const again = sink.rows();
  assert.notEqual(listed, again);
  assert.equal(listed.length, 3);
  assert.notEqual(listed[0], again[0]);
  assert.notEqual(listed[0], listed[1]);
  assert.equal(listed[0]?.adapter, "catalog");
  assert.equal(listed[1]?.adapter, "catalog");
  assert.equal(listed[2]?.adapter, "mail");
  assert.equal(listed[2]?.time, FALLBACK_TIME);
  assert.equal(JSON.stringify(listed[0]).includes("person@example.test"), false);
  assert.deepEqual(Object.keys(listed[0] ?? {}).sort(), ROW_KEYS);
  const copy = listed[0];
  assert.ok(copy);
  Object.assign(copy, { adapter: "mutated" });
  assert.equal(sink.rows()[0]?.adapter, "catalog");
});

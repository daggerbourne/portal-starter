import assert from "node:assert/strict";
import { test } from "node:test";
import { exchangeEntraCode, type TokenTransport } from "../../../adapters/entra/exchange-code.js";
import { createMemoryAuditSink } from "../../../core/adapter-gate/memory-audit-sink.js";
import {
  AdapterRefusal,
  type AdapterDeps,
  type EnvName,
  type EnvReader,
} from "../../../core/adapter-gate/run-adapter.js";

const TENANT = "tenant.example.test";
const CLIENT = "client.example.test";
const SECRET = "synthetic-secret";
const NOW = "2026-03-08T07:30:00.000Z";

function envFrom(record: Partial<Record<EnvName, string>>): EnvReader {
  return (name) => record[name];
}

function setup(record: Partial<Record<EnvName, string>>, transport: TokenTransport): {
  sink: ReturnType<typeof createMemoryAuditSink>;
  deps: {
    gate: AdapterDeps;
    tenantId: string;
    clientId: string;
    clientSecret: string | undefined;
    mockIdToken: (code: string) => string | undefined;
    transport: TokenTransport;
  };
} {
  const sink = createMemoryAuditSink();
  return {
    sink,
    deps: {
      gate: {
        env: envFrom(record),
        clock: () => new Date(NOW),
        audit: sink,
      },
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: SECRET,
      mockIdToken: (code) => (code === "synthetic-code" ? "header.payload.unsigned" : undefined),
      transport,
    },
  };
}

test("mock returns the canned id token and writes one allowed row", async () => {
  let calls = 0;
  const { deps, sink } = setup({ MODE: "mock", APP_DEPLOY_CONTEXT: "dev" }, () => {
    calls += 1;
    return Promise.reject(new Error("transport called"));
  });
  const idToken = await exchangeEntraCode(
    { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
    deps,
  );
  assert.equal(idToken, "header.payload.unsigned");
  assert.equal(calls, 0);
  assert.equal(sink.rows().length, 1);
  assert.equal(sink.rows()[0]?.adapter, "entra");
  assert.equal(sink.rows()[0]?.mode, "mock");
  assert.equal(sink.rows()[0]?.context, "dev");
  assert.equal(sink.rows()[0]?.outcome, "allowed");
  assert.equal(sink.rows()[0]?.time, NOW);
  assert.equal(JSON.stringify(sink.rows()).includes(SECRET), false);
});

test("APP_KILL blocks the token call", async () => {
  let calls = 0;
  const { deps, sink } = setup({ MODE: "mock", APP_KILL: "1", APP_DEPLOY_CONTEXT: "dev" }, () => {
    calls += 1;
    return Promise.resolve({ status: 200, body: "" });
  });
  await assert.rejects(
    () => exchangeEntraCode({ code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" }, deps),
    (error: unknown) => error instanceof AdapterRefusal && error.outcome === "killed",
  );
  assert.equal(calls, 0);
  assert.equal(sink.rows()[0]?.outcome, "killed");
});

test("live is refused outside production and allowed in production", async () => {
  let calls = 0;
  const transport: TokenTransport = (request) => {
    calls += 1;
    assert.equal(request.url, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const body = new URLSearchParams(request.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("client_id"), CLIENT);
    assert.equal(body.get("client_secret"), SECRET);
    assert.equal(body.get("code"), "synthetic-code");
    assert.equal(body.get("redirect_uri"), "http://localhost:8888/portal-starter/auth/callback");
    assert.equal(body.get("scope"), "openid profile email");
    return Promise.resolve({ status: 200, body: JSON.stringify({ id_token: "live.payload.unsigned" }) });
  };
  const refused = setup({ MODE: "live", APP_DEPLOY_CONTEXT: "dev" }, transport);
  await assert.rejects(
    () =>
      exchangeEntraCode(
        { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
        refused.deps,
      ),
    (error: unknown) => error instanceof AdapterRefusal && error.outcome === "live_refused",
  );
  assert.equal(calls, 0);
  assert.equal(refused.sink.rows()[0]?.outcome, "live_refused");

  const allowed = setup({ MODE: "live", APP_DEPLOY_CONTEXT: "production" }, transport);
  const idToken = await exchangeEntraCode(
    { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
    allowed.deps,
  );
  assert.equal(idToken, "live.payload.unsigned");
  assert.equal(calls, 1);
  assert.equal(allowed.sink.rows()[0]?.outcome, "allowed");
  assert.equal(JSON.stringify(allowed.sink.rows()).includes(SECRET), false);
});

test("sandbox reaches the token endpoint outside production", async () => {
  let calls = 0;
  const { deps, sink } = setup({ MODE: "sandbox", APP_DEPLOY_CONTEXT: "dev" }, (request) => {
    calls += 1;
    assert.equal(request.url, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    return Promise.resolve({ status: 200, body: JSON.stringify({ id_token: "sandbox.payload.unsigned" }) });
  });
  const idToken = await exchangeEntraCode(
    { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
    deps,
  );
  assert.equal(idToken, "sandbox.payload.unsigned");
  assert.equal(calls, 1);
  assert.equal(sink.rows()[0]?.mode, "sandbox");
  assert.equal(sink.rows()[0]?.outcome, "allowed");
});

async function withStderr(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    await run();
    return lines.join("");
  } finally {
    process.stderr.write = write;
  }
}

test("a missing secret or a refused token does not echo the secret", async () => {
  let calls = 0;
  const missing = setup({ MODE: "live", APP_DEPLOY_CONTEXT: "production" }, () => {
    calls += 1;
    return Promise.resolve({ status: 200, body: "{}" });
  });
  missing.deps = { ...missing.deps, clientSecret: undefined };
  const missingLog = await withStderr(async () => {
    await assert.rejects(
      () =>
        exchangeEntraCode(
          { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
          missing.deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(SECRET), false);
        return true;
      },
    );
  });
  assert.equal(calls, 0);
  assert.equal(missing.sink.rows()[0]?.outcome, "adapter_error");
  assert.equal(missingLog, "entra token status none host localhost:8888 error missing_client\n");
  assert.equal(missingLog.includes(SECRET), false);
  assert.equal(missingLog.includes("synthetic-code"), false);

  const refused = setup({ MODE: "sandbox", APP_DEPLOY_CONTEXT: "dev" }, () => {
    calls += 1;
    return Promise.resolve({ status: 400, body: `secret ${SECRET}` });
  });
  const refusedLog = await withStderr(async () => {
    await assert.rejects(
      () =>
        exchangeEntraCode(
          { code: "synthetic-code", redirectUri: "http://localhost:8888/portal-starter/auth/callback" },
          refused.deps,
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(SECRET), false);
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  });
  assert.equal(calls, 1);
  assert.equal(refused.sink.rows()[0]?.outcome, "adapter_error");
  assert.equal(JSON.stringify(refused.sink.rows()).includes(SECRET), false);
  assert.equal(refusedLog, "entra token status 400 host localhost:8888 error\n");
  assert.equal(refusedLog.includes(SECRET), false);
  assert.equal(refusedLog.includes("synthetic-code"), false);
});

test("a refused token logs the entra code, the AADSTS number, the status, and the host", async () => {
  const redirectUri = "https://auth-test--portal-starter.netlify.app/portal-starter/auth/callback";
  const { deps, sink } = setup({ MODE: "sandbox", APP_DEPLOY_CONTEXT: "dev" }, () =>
    Promise.resolve({
      status: 401,
      body: JSON.stringify({
        error: `invalid_${SECRET}_client`,
        error_description: `AADSTS7000215: Invalid client secret provided. code synthetic-code secret ${SECRET}`,
        access_token: "synthetic-token",
        id_token: "header.payload.unsigned",
      }),
    }),
  );
  const logged = await withStderr(async () => {
    await assert.rejects(
      () => exchangeEntraCode({ code: "synthetic-code", redirectUri }, deps),
      (error: unknown) => error instanceof Error && error.message === "Entra token endpoint refused the code.",
    );
  });
  assert.equal(logged, "entra token status 401 host auth-test--portal-starter.netlify.app error invalid__client AADSTS7000215\n");
  assert.equal(logged.includes(SECRET), false);
  assert.equal(logged.includes("synthetic-code"), false);
  assert.equal(logged.includes("synthetic-token"), false);
  assert.equal(logged.includes("header.payload.unsigned"), false);
  assert.equal(sink.rows()[0]?.outcome, "adapter_error");
});

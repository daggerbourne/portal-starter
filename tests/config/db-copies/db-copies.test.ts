import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ensureDecision,
  execute,
  planCopy,
  planDevMigrate,
  planSweep,
  type BranchRecord,
  type Http,
  type HttpInput,
  type HttpResult,
  type Io,
} from "../../../.github/db-copies/run.js";
import { judgeWorkflowPermissions, workflowFacts } from "../../../.github/guards/check.js";

const repoRoot = path.join(import.meta.dirname, "../../..");
const HEAD = "b".repeat(40);
const DIRECT = "postgres://owner:direct-secret@db.example.test/neondb";
const POOLED = "postgres://owner:pooled-secret@pool.example.test/neondb";
const SQL = "create table demo (id int);\n";
const SQL_NAME = "20260101T1200_init.sql";
const CONTENTS = `https://api.github.com/repos/acme/portal-starter/contents/db/${SQL_NAME}?ref=${"a".repeat(40)}`;

const BASE: NodeJS.ProcessEnv = {
  FORK: "false",
  PR_NUMBER: "12",
  HEAD_SHA: HEAD,
  HEAD_REF: "cfg/widget",
  GITHUB_REPOSITORY: "acme/portal-starter",
  GITHUB_TOKEN: "github-token-value",
  NEON_API_KEY: "neon-api-key-value",
  NEON_PROJECT_ID: "project",
  NETLIFY_AUTH_TOKEN: "netlify-token-value",
  NETLIFY_SITE_ID: "site",
};

function branch(id: string, name: string, parentId: string): BranchRecord {
  return { id, name, parentId };
}

function response(status: number, body: unknown, link: string | null = null): HttpResult {
  return { status, body: typeof body === "string" ? body : JSON.stringify(body), link };
}

function pathname(url: string): string {
  return new URL(url).pathname;
}

function script(route: (input: HttpInput) => HttpResult | undefined): { http: Http; calls: HttpInput[] } {
  const calls: HttpInput[] = [];
  return {
    calls,
    http: async (input) => {
      calls.push(input);
      const result = route(input);
      if (result === undefined) throw new Error(`unexpected ${input.method} ${pathname(input.url)}`);
      return result;
    },
  };
}

function harness(env: NodeJS.ProcessEnv, http: Http, extra?: Partial<Pick<Io, "migrate" | "sleep" | "cwd">>) {
  let out = "";
  let err = "";
  const migrated: { url: string; dir: string }[] = [];
  const io: Io = {
    env,
    cwd: extra?.cwd ?? repoRoot,
    http,
    migrate: extra?.migrate ?? (async (url, dir) => { migrated.push({ url, dir }); }),
    sleep: extra?.sleep ?? (async () => { throw new Error("slept"); }),
    stdout: (line) => { out += line; },
    stderr: (line) => { err += line; },
  };
  return { io, out: () => out, err: () => err, migrated };
}

function wire(id: string, name: string, parent: string | null): { id: string; name: string; parent_id: string | null } {
  return { id, name, parent_id: parent };
}

const dev = wire("br-dev", "dev", "br-prod");
const prod = wire("br-prod", "production", null);

function sqlFile(name = SQL_NAME): { filename: string; status: string; contents_url: string } {
  return { filename: `db/${name}`, status: "added", contents_url: CONTENTS };
}

function posts(calls: readonly HttpInput[], suffix: string): HttpInput[] {
  return calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith(suffix));
}

function copyReady(routeEnv: (input: HttpInput) => HttpResult | undefined) {
  return script((input) => {
    const pathName = pathname(input.url);
    if (pathName.endsWith("/files")) return response(200, [sqlFile()]);
    if (input.method === "GET" && pathName.endsWith("/branches")) {
      return response(200, { branches: [dev, prod, wire("br-pr-12", "preview/pr-12", "br-dev")] });
    }
    if (pathName.endsWith("/connection_uri")) {
      return response(200, { uri: new URL(input.url).searchParams.get("pooled") === "true" ? POOLED : DIRECT });
    }
    if (pathName.includes("/contents/")) return response(200, SQL);
    if (input.method === "GET" && pathName.endsWith("/sites/site")) return response(200, { account_id: "acct" });
    const decided = routeEnv(input);
    if (decided !== undefined) return decided;
    if (input.method === "GET" && pathName.endsWith("/deploys")) {
      return response(200, [{ id: "dep-preview", context: "deploy-preview", branch: "cfg/widget", review_id: 12, ssl_url: "https://deploy-preview-12--site.netlify.app" }]);
    }
    if (input.method === "POST" && pathName.endsWith("/retry")) return response(201, {});
    return undefined;
  });
}

type EnvWrite = {
  key: string;
  is_secret: boolean;
  scopes?: string[];
  values: { value: string; context: string; context_parameter: string }[];
};

function envBody(call: HttpInput): EnvWrite[] {
  return JSON.parse(call.body ?? "[]") as EnvWrite[];
}

function deletes(calls: readonly HttpInput[]): HttpInput[] {
  return calls.filter((call) => call.method === "DELETE");
}

test("planCopy names a preview only for db or server", () => {
  assert.deepEqual(planCopy(12, ["db/a.sql"]), { kind: "copy", pr: 12, name: "preview/pr-12" });
  assert.deepEqual(planCopy(4, ["server"]), { kind: "copy", pr: 4, name: "preview/pr-4" });
  assert.deepEqual(planCopy(4, ["db"]), { kind: "copy", pr: 4, name: "preview/pr-4" });
  assert.deepEqual(planCopy(4, ["server/a.ts"]), { kind: "copy", pr: 4, name: "preview/pr-4" });
  assert.deepEqual(planCopy(4, ["notes/db/a.sql"]), { kind: "skip" });
  assert.deepEqual(planCopy(4, ["server2/a.ts"]), { kind: "skip" });
  assert.deepEqual(planCopy(4, ["ui/a.ts"]), { kind: "skip" });
  assert.deepEqual(planCopy(4, []), { kind: "skip" });
});

test("planDevMigrate follows db paths and unknown", () => {
  assert.deepEqual(planDevMigrate(["db/a.sql"]), { kind: "migrate" });
  assert.deepEqual(planDevMigrate(["db"]), { kind: "migrate" });
  assert.deepEqual(planDevMigrate("unknown"), { kind: "migrate" });
  assert.deepEqual(planDevMigrate(["server/a.ts"]), { kind: "skip" });
  assert.deepEqual(planDevMigrate(["ui/a.ts"]), { kind: "skip" });
  assert.deepEqual(planDevMigrate(["notes/db/a.sql"]), { kind: "skip" });
});

test("ensureDecision reuses one dev child, stops, or reports full", () => {
  const devBranch = branch("br-dev", "dev", "br-prod");
  const prodBranch = branch("br-prod", "production", "");
  const copies = Array.from({ length: 8 }, (_, index) => branch(`br-${index + 1}`, `preview/pr-${index + 1}`, "br-dev"));
  assert.deepEqual(ensureDecision("preview/pr-9", [prodBranch]), { kind: "stop", reason: "parent is not dev" });
  assert.deepEqual(ensureDecision("preview/pr-9", [devBranch, branch("br-dev-2", "dev", ""), prodBranch]), { kind: "stop", reason: "parent is not dev" });
  assert.deepEqual(ensureDecision("preview/pr-9", [branch("br-same", "dev", ""), branch("br-same", "production", "")]), { kind: "stop", reason: "parent is not dev" });
  assert.deepEqual(ensureDecision("preview/pr-3", [devBranch, branch("br-a", "preview/pr-3", "br-dev"), branch("br-b", "preview/pr-3", "br-dev")]), { kind: "stop", reason: "duplicate copy" });
  assert.deepEqual(ensureDecision("preview/pr-3", [branch("br-a", "preview/pr-3", "br-dev"), branch("br-b", "preview/pr-3", "br-dev")]), { kind: "stop", reason: "duplicate copy" });
  assert.deepEqual(ensureDecision("preview/pr-9", [devBranch, prodBranch, ...copies]), { kind: "full" });
  assert.deepEqual(ensureDecision("preview/pr-1", [devBranch, prodBranch, ...copies]), { kind: "reuse", branch: copies[0] });
  assert.deepEqual(ensureDecision("preview/pr-9", [devBranch, prodBranch, ...copies.slice(0, 7), branch("br-01", "preview/pr-01", "br-dev")]), { kind: "create", parentId: "br-dev" });
  assert.deepEqual(ensureDecision("preview/pr-2", [devBranch, branch("br-2", "preview/pr-2", "br-prod")]), { kind: "stop", reason: "parent is not dev" });
});

test("planSweep deletes a closed pull and keeps the rest", () => {
  assert.deepEqual(planSweep("closed"), { kind: "delete" });
  assert.deepEqual(planSweep("open"), { kind: "keep" });
  assert.deepEqual(planSweep("missing"), { kind: "keep" });
});

test("a pull that changes neither db nor server makes no database or preview request", async () => {
  const env = { ...BASE };
  delete env.NEON_API_KEY;
  delete env.NETLIFY_AUTH_TOKEN;
  delete env.NEON_PROJECT_ID;
  delete env.NETLIFY_SITE_ID;
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/pulls/12/files")) {
      return response(200, [
        { filename: "ui/a.ts", status: "modified" },
        { filename: "notes/db/a.sql", status: "added" },
        { filename: "server2/a.ts", status: "modified" },
      ], '<https://files.example.test/next>; rel="next"');
    }
    return undefined;
  });
  const run = harness(env, routed.http);
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(run.migrated.length, 0);
  assert.equal(run.out(), "");
  assert.deepEqual(routed.calls.map((call) => pathname(call.url)), ["/repos/acme/portal-starter/pulls/12/files"]);
  assert.equal(routed.calls.some((call) => call.url.includes("files.example.test")), false);
});

test("a renamed server path still asks for a copy", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) {
      return response(200, [{ filename: "notes/a.ts", status: "renamed", previous_filename: "server/a.ts" }]);
    }
    if (pathname(input.url).endsWith("/branches")) return response(200, { branches: [prod] });
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "parent is not dev\n");
  assert.equal(posts(routed.calls, "/branches").length, 0);
  assert.equal(run.migrated.length, 0);
});

test("no dev branch stops before create", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (pathname(input.url).endsWith("/branches")) return response(200, { branches: [prod] });
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "parent is not dev\n");
  assert.equal(posts(routed.calls, "/branches").length, 0);
  assert.equal(run.migrated.length, 0);
});

test("a created branch whose parent is not dev is deleted and not migrated", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (input.method === "GET" && pathname(input.url).endsWith("/branches")) return response(200, { branches: [dev, prod] });
    if (input.method === "POST" && pathname(input.url).endsWith("/branches")) {
      return response(201, { branch: { id: "br-new", name: "preview/pr-12", parent_id: "br-prod" } });
    }
    if (input.method === "DELETE") return response(200, "");
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "parent is not dev\n");
  assert.equal(posts(routed.calls, "/branches").length, 1);
  assert.deepEqual(deletes(routed.calls).map((call) => pathname(call.url)), ["/api/v2/projects/project/branches/br-new"]);
  assert.equal(run.migrated.length, 0);
});

test("eight previews fail before a ninth create", async () => {
  const previews = Array.from({ length: 8 }, (_, index) => wire(`br-${index + 1}`, `preview/pr-${index + 1}`, "br-dev"));
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [{ filename: "server/a.ts", status: "modified" }]);
    if (pathname(input.url).endsWith("/branches")) return response(200, { branches: [dev, prod, ...previews] });
    return undefined;
  });
  const env = { ...BASE, PR_NUMBER: "9" };
  const run = harness(env, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "database copies full\n");
  assert.equal(posts(routed.calls, "/branches").length, 0);
  assert.equal(run.migrated.length, 0);
});

test("a branch limit response fails once and does not migrate", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (input.method === "GET" && pathname(input.url).endsWith("/branches")) return response(200, { branches: [dev, prod] });
    if (input.method === "POST" && pathname(input.url).endsWith("/branches")) return response(422, { message: "branches limit exceeded" });
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "database copies full\n");
  assert.equal(posts(routed.calls, "/branches").length, 1);
  assert.equal(run.migrated.length, 0);
});

test("an existing copy is migrated again and the preview values are patched", async () => {
  let created = false;
  let polls = 0;
  const present = new Set<string>();
  const routed = script((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.endsWith("/files")) {
      const page = new URL(input.url).searchParams.get("page");
      if (page === "2") return response(200, [sqlFile(), { filename: "db/old.sql", status: "removed", contents_url: CONTENTS }]);
      return response(200, [{ filename: "ui/a.ts", status: "modified" }], '<https://api.github.com/repos/acme/portal-starter/pulls/12/files?page=2>; rel="next"');
    }
    if (input.method === "GET" && pathName.includes("/contents/")) {
      assert.equal(new URL(input.url).searchParams.get("ref"), HEAD);
      assert.equal(input.headers.Accept, "application/vnd.github.raw");
      return response(200, SQL);
    }
    if (input.method === "GET" && pathName.endsWith("/branches")) {
      const branches = [dev, prod];
      if (created) branches.push(wire("br-pr-12", "preview/pr-12", "br-dev"));
      return response(200, { branches });
    }
    if (input.method === "POST" && pathName.endsWith("/branches")) {
      created = true;
      return response(201, { branch: wire("br-pr-12", "preview/pr-12", "br-dev"), operations: [{ id: "op-1" }] });
    }
    if (input.method === "GET" && pathName.includes("/operations/")) {
      polls += 1;
      return response(200, { operation: { status: "finished" } });
    }
    if (pathName.endsWith("/connection_uri")) {
      const params = new URL(input.url).searchParams;
      assert.equal(params.get("database_name"), "neondb");
      assert.equal(params.get("role_name"), "neondb_owner");
      assert.equal(params.get("branch_id"), "br-pr-12");
      return response(200, { uri: params.get("pooled") === "true" ? POOLED : DIRECT });
    }
    if (input.method === "GET" && pathName.endsWith("/sites/site")) return response(200, { account_id: "acct", account_slug: "team" });
    if (input.method === "GET" && pathName.includes("/env/")) {
      const key = pathName.split("/env/")[1] ?? "";
      if (!present.has(key)) return response(404, "");
      return response(200, { values: [{ id: `val-${key}`, context: "branch", context_parameter: "cfg/widget" }] });
    }
    if (input.method === "POST" && pathName.endsWith("/env")) {
      const body = JSON.parse(input.body ?? "[]") as { key: string }[];
      const item = body[0];
      if (item !== undefined) present.add(item.key);
      return response(201, {});
    }
    if (input.method === "PATCH" && pathName.includes("/env/")) return response(201, {});
    if (input.method === "GET" && pathName.endsWith("/deploys")) {
      return response(200, [{ id: "dep-preview", context: "deploy-preview", branch: "cfg/widget", review_id: 12, ssl_url: "https://deploy-preview-12--site.netlify.app" }]);
    }
    if (input.method === "POST" && pathName.endsWith("/retry")) return response(200, {});
    return undefined;
  });
  let slept = false;
  const seen: string[] = [];
  const run = harness(BASE, routed.http, {
    sleep: async () => { slept = true; },
    migrate: async (url, dir) => {
      seen.push(readFileSync(path.join(dir, SQL_NAME), "utf8"));
      assert.equal(readdirSync(dir).includes("old.sql"), false);
      assert.equal(run.out().includes(`::add-mask::${url}`), true);
      run.migrated.push({ url, dir });
    },
  });
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(slept, false);
  assert.equal(polls, 1);
  assert.equal(posts(routed.calls, "/branches").length, 1);
  assert.deepEqual(JSON.parse(posts(routed.calls, "/branches")[0]?.body ?? "{}"), {
    branch: { name: "preview/pr-12", parent_id: "br-dev" },
    endpoints: [{ type: "read_write" }],
  });
  assert.deepEqual(run.migrated.map((item) => item.url), [DIRECT, DIRECT]);
  assert.deepEqual(seen, [SQL, SQL]);
  const envPosts = posts(routed.calls, "/env");
  assert.equal(envPosts.length, 2);
  const posted = envPosts.map((call) => JSON.parse(call.body ?? "[]") as { key: string; is_secret: boolean; scopes?: unknown; values: { value: string; context: string; context_parameter: string }[] }[]);
  assert.equal(posted.every((body) => body.length === 1), true);
  assert.deepEqual(posted.find((body) => body[0]?.key === "DATABASE_URL")?.[0], {
    key: "DATABASE_URL", is_secret: true, scopes: ["builds", "functions", "runtime"], values: [{ value: POOLED, context: "branch", context_parameter: "cfg/widget" }],
  });
  assert.deepEqual(posted.find((body) => body[0]?.key === "APP_DB_LABEL")?.[0], {
    key: "APP_DB_LABEL", is_secret: false, values: [{ value: "preview/pr-12", context: "branch", context_parameter: "cfg/widget" }],
  });
  const patches = routed.calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.deepEqual(JSON.parse(patches.find((call) => call.url.includes("DATABASE_URL"))?.body ?? "{}"), {
    context: "branch", context_parameter: "cfg/widget", value: POOLED,
  });
  assert.deepEqual(JSON.parse(patches.find((call) => call.url.includes("APP_DB_LABEL"))?.body ?? "{}"), {
    context: "branch", context_parameter: "cfg/widget", value: "preview/pr-12",
  });
  assert.equal(patches.every((call) => call.url.includes("/accounts/acct/")), true);
  assert.equal(patches.some((call) => call.url.includes("/accounts/team/")), false);
  const retries = routed.calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith("/retry")).map((call) => pathname(call.url));
  assert.deepEqual(retries, ["/api/v1/deploys/dep-preview/retry", "/api/v1/deploys/dep-preview/retry"]);
  assert.equal(posts(routed.calls, "/builds").length, 0);
  const filesCall = routed.calls.find((call) => call.url.includes("/files"));
  assert.equal(filesCall?.headers.Authorization, "Bearer github-token-value");
  assert.equal(filesCall?.headers.Accept, "application/vnd.github+json");
  assert.equal(filesCall?.headers["User-Agent"], "app-db-copies");
  assert.equal(filesCall?.headers["X-GitHub-Api-Version"], "2022-11-28");
  assertNoUriOrSecret(proofLines(run.out()).join("\n"));
});

test("a migrate failure leaves the connection string only on the mask line", async () => {
  let dir = "";
  const routed = script((input) => {
    const pathName = pathname(input.url);
    if (pathName.endsWith("/files")) return response(200, [sqlFile()]);
    if (input.method === "GET" && pathName.endsWith("/branches")) return response(200, { branches: [dev, prod, wire("br-pr-12", "preview/pr-12", "br-dev")] });
    if (pathName.endsWith("/connection_uri")) {
      const pooled = new URL(input.url).searchParams.get("pooled") === "true";
      return response(200, { uri: pooled ? POOLED : DIRECT });
    }
    if (pathName.includes("/contents/")) return response(200, SQL);
    return undefined;
  });
  const run = harness(BASE, routed.http, {
    migrate: async (url, sqlDir) => {
      dir = sqlDir;
      assert.equal(readFileSync(path.join(sqlDir, SQL_NAME), "utf8"), SQL);
      throw new Error(`failed ${url} and postgres://other:pw@db.example.test/neondb`);
    },
  });
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(existsSync(dir), false);
  assert.equal(run.out().includes("provision preview/pr-12 parent dev\n"), true);
  assert.equal(run.out().includes(`::add-mask::${DIRECT}\n`), true);
  assert.equal(run.out().includes(`::add-mask::${POOLED}\n`), true);
  assertNoUriOrSecret(proofLines(run.out()).join("\n"));
  assert.equal(run.err().includes(DIRECT), false);
  assert.equal(run.err().includes(POOLED), false);
  assert.equal(run.err().includes("postgres://"), false);
  assert.equal(run.err().includes("direct-secret"), false);
  assert.equal(posts(routed.calls, "/builds").length, 0);
  assert.equal(routed.calls.some((call) => call.url.includes("netlify.com")), false);
});

test("an http error keeps the status and message and drops the rest of the body", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (pathname(input.url).endsWith("/branches")) {
      return response(500, { message: `nope ${DIRECT}`, noise: "raw-body-marker", token: "neon-api-key-value" });
    }
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err().includes(DIRECT), false);
  assert.equal(run.err().includes("postgres://"), false);
  assert.equal(run.err().includes("raw-body-marker"), false);
  assert.equal(run.err().includes("neon-api-key-value"), false);
  assert.equal(run.err(), "GET /api/v2/projects/project/branches 500 nope [redacted]\n");
});

test("a missing secret database url is created with builds, functions, and runtime scopes", async () => {
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method !== "POST" || !pathName.endsWith("/env")) return undefined;
    const item = envBody(input)[0];
    if (item?.is_secret === true) {
      const scopes = item.scopes ?? [];
      const explicit = scopes.length === 3 && ["builds", "functions", "runtime"].every((scope) => scopes.includes(scope));
      if (!explicit || scopes.some((scope) => /post[-_]processing/.test(scope))) {
        return response(422, { code: 422, msg: "Secrets are not allowed to run in 'post_processing' scopes." });
      }
    }
    return response(201, {});
  });
  const run = harness(BASE, routed.http, {
    migrate: async () => ({ applied: [SQL_NAME, "20260102T1300_next.sql", DIRECT, "neon-api-key-value"] }),
  });
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(run.err(), "");
  assert.deepEqual(proofLines(run.out()), ["provision preview/pr-12 parent dev", SQL_NAME, "20260102T1300_next.sql"]);
  assert.equal(run.out().includes(`::add-mask::${DIRECT}\n`), true);
  assert.equal(run.out().includes(`::add-mask::${POOLED}\n`), true);
  assert.equal(routed.calls.some((call) => call.method === "PATCH"), false);
  const posted = posts(routed.calls, "/env").map((call) => envBody(call));
  assert.deepEqual(posted.find((body) => body[0]?.key === "DATABASE_URL")?.[0], {
    key: "DATABASE_URL",
    is_secret: true,
    scopes: ["builds", "functions", "runtime"],
    values: [{ value: POOLED, context: "branch", context_parameter: "cfg/widget" }],
  });
  assert.deepEqual(posted.find((body) => body[0]?.key === "APP_DB_LABEL")?.[0], {
    key: "APP_DB_LABEL",
    is_secret: false,
    values: [{ value: "preview/pr-12", context: "branch", context_parameter: "cfg/widget" }],
  });
  assert.equal(routed.calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith("/retry")).length, 1);
  assert.equal(posts(routed.calls, "/builds").length, 0);
});

test("a secret the site read misses is written onto the existing key", async () => {
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method === "POST" && pathName.endsWith("/env")) {
      const item = envBody(input)[0];
      if (item?.key === "DATABASE_URL") {
        return response(422, {
          code: 422,
          msg: "Environment variable with the same key name already exists on this site. Try a different key or edit the existing variable.",
        });
      }
      return response(201, {});
    }
    if (input.method === "PATCH" && pathName.includes("/env/")) return response(201, {});
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(run.err(), "");
  const patch = routed.calls.find((call) => call.method === "PATCH" && call.url.includes("DATABASE_URL"));
  assert.deepEqual(JSON.parse(patch?.body ?? "{}"), {
    context: "branch",
    context_parameter: "cfg/widget",
    value: POOLED,
  });
  assert.equal(routed.calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(routed.calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith("/retry")).length, 1);
  assert.equal(posts(routed.calls, "/builds").length, 0);
});

test("a netlify 422 in errors names the call and hides the rest of the body", async () => {
  const cases: { body: unknown; detail: string }[] = [
    {
      body: { errors: `branch context rejected ${POOLED}`, noise: "raw-body-marker" },
      detail: "branch context rejected [redacted]",
    },
    {
      body: { errors: ["branch rejected", "scope rejected"], noise: "raw-body-marker" },
      detail: "branch rejected; scope rejected",
    },
    {
      body: { errors: { context: "branch rejected" }, noise: "raw-body-marker" },
      detail: '{"context":"branch rejected"}',
    },
  ];
  for (const item of cases) {
    const routed = copyReady((input) => {
      const pathName = pathname(input.url);
      if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
      if (input.method === "POST" && pathName.endsWith("/env")) return response(422, item.body);
      return undefined;
    });
    const run = harness(BASE, routed.http);
    assert.equal(await execute("copy", run.io), 1);
    assert.equal(run.err(), `POST /api/v1/accounts/acct/env 422 ${item.detail}\n`);
    assert.equal(run.err().includes("raw-body-marker"), false);
    assert.equal(run.err().includes(POOLED), false);
    assert.equal(run.err().includes("postgres://"), false);
    assert.equal(posts(routed.calls, "/builds").length, 0);
  }
});

test("a netlify 422 with no reason field prints the raw body and drops the connection string", async () => {
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method === "POST" && pathName.endsWith("/env")) return response(422, `rejected ${POOLED} ${"y".repeat(400)}`);
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  const err = run.err();
  assert.equal(err.startsWith("POST /api/v1/accounts/acct/env 422 rejected [redacted] "), true);
  assert.equal(err.endsWith("...\n"), true);
  assert.equal(err.includes(POOLED), false);
  assert.equal(err.includes("postgres://"), false);
  assert.equal(err.includes("y".repeat(300)), false);
  assert.equal(posts(routed.calls, "/builds").length, 0);
});

test("an errors body that says the key already exists sets the branch value", async () => {
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method === "POST" && pathName.endsWith("/env")) {
      const item = envBody(input)[0];
      if (item?.key === "DATABASE_URL") {
        return response(422, { errors: "Environment variable with the same key name already exists on this site." });
      }
      return response(201, {});
    }
    if (input.method === "PATCH" && pathName.includes("/env/")) return response(201, {});
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(run.err(), "");
  const patch = routed.calls.find((call) => call.method === "PATCH" && call.url.includes("DATABASE_URL"));
  assert.deepEqual(JSON.parse(patch?.body ?? "{}"), {
    context: "branch",
    context_parameter: "cfg/widget",
    value: POOLED,
  });
  assert.equal(routed.calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith("/retry")).length, 1);
  assert.equal(posts(routed.calls, "/builds").length, 0);
});

const GITHUB_REVIEW_REFUSAL = { error: "review_id is not supported for GitHub repositories" };

function deployRow(id: string, fields: { context?: string; branch?: string; review_id?: number | null; ssl_url?: string }): { id: string; context: string; branch: string; review_id: number | null; ssl_url: string } {
  return {
    id,
    context: fields.context ?? "deploy-preview",
    branch: fields.branch ?? "other",
    review_id: fields.review_id === undefined ? null : fields.review_id,
    ssl_url: fields.ssl_url ?? "https://other.example.test",
  };
}

test("a github review build is refused and the pull request preview is retried", async () => {
  let page = 0;
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    const url = new URL(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method === "POST" && pathName.endsWith("/env")) return response(201, {});
    if (input.method === "POST" && pathName.endsWith("/builds")) {
      assert.equal(url.searchParams.get("review_id"), "12");
      assert.equal(url.searchParams.get("clear_cache"), "true");
      return response(422, GITHUB_REVIEW_REFUSAL);
    }
    if (input.method === "GET" && pathName.endsWith("/deploys")) {
      page += 1;
      if (page === 1) {
        assert.equal(url.searchParams.get("deploy-previews"), "true");
        assert.equal(url.searchParams.get("review_id"), null);
        return response(200, [
          deployRow("dep-branch", { context: "branch-deploy", branch: "cfg/widget" }),
          deployRow("dep-same-branch", { branch: "cfg/widget", review_id: 9, ssl_url: "https://deploy-preview-9--site.netlify.app" }),
        ], '<https://api.netlify.com/api/v1/sites/site/deploys?page=2>; rel="next"');
      }
      return response(200, [deployRow("dep-preview", { branch: "cfg/widget", review_id: 12, ssl_url: "https://deploy-preview-12--site.netlify.app" })]);
    }
    if (input.method === "POST" && pathName === "/api/v1/deploys/dep-preview/retry") {
      assert.equal(input.body, undefined);
      assert.equal(url.search, "");
      return response(201, { id: "dep-retry" });
    }
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 0);
  assert.equal(run.err(), "");
  assert.equal(posts(routed.calls, "/builds").length, 0);
  assert.deepEqual(routed.calls.filter((call) => call.method === "POST" && pathname(call.url).endsWith("/retry")).map((call) => pathname(call.url)), ["/api/v1/deploys/dep-preview/retry"]);
  assertNoUriOrSecret(proofLines(run.out()).join("\n"));
  assert.equal(run.err().includes("netlify-token-value"), false);
  assert.equal(run.err().includes(POOLED), false);
  assert.equal(run.err().includes("pooled-secret"), false);
});

test("a preview is retried by branch or by its deploy-preview url", async () => {
  const lists = [
    [deployRow("dep-branch", { branch: "cfg/widget", ssl_url: "https://random.example.test" })],
    [deployRow("dep-url", { branch: "pull/12/head", ssl_url: "https://deploy-preview-12--site.netlify.app" })],
  ];
  for (const list of lists) {
    const routed = copyReady((input) => {
      const pathName = pathname(input.url);
      if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
      if (input.method === "POST" && pathName.endsWith("/env")) return response(201, {});
      if (input.method === "POST" && pathName.endsWith("/builds")) return response(422, GITHUB_REVIEW_REFUSAL);
      if (input.method === "GET" && pathName.endsWith("/deploys")) return response(200, list);
      if (input.method === "POST" && pathname(input.url).endsWith("/retry")) return response(200, {});
      return undefined;
    });
    const run = harness(BASE, routed.http);
    assert.equal(await execute("copy", run.io), 0);
    assert.equal(run.err(), "");
    const retry = routed.calls.find((call) => call.method === "POST" && pathname(call.url).endsWith("/retry"));
    assert.equal(pathname(retry?.url ?? ""), `/api/v1/deploys/${list[0]?.id}/retry`);
    assert.equal(posts(routed.calls, "/builds").length, 0);
  }
});

test("a copy with no pull request preview names the miss and does not start a review build", async () => {
  const routed = copyReady((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.includes("/env/")) return response(404, "");
    if (input.method === "POST" && pathName.endsWith("/env")) return response(201, {});
    if (input.method === "POST" && pathName.endsWith("/builds")) return response(422, GITHUB_REVIEW_REFUSAL);
    if (input.method === "GET" && pathName.endsWith("/deploys")) {
      return response(200, [deployRow("dep-other", { review_id: 9, ssl_url: "https://deploy-preview-9--site.netlify.app" })], '<https://files.example.test/deploys>; rel="next"');
    }
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "preview deploy missing\n");
  assert.equal(posts(routed.calls, "/builds").length, 0);
  assert.equal(routed.calls.some((call) => call.url.includes("files.example.test")), false);
  assert.equal(run.err().includes("netlify-token-value"), false);
  assert.equal(run.err().includes(POOLED), false);
});

test("a netlify error reported in msg is kept and the rest of the body is dropped", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (pathname(input.url).endsWith("/branches")) {
      return response(422, { code: 422, msg: "scopes rejected", noise: "raw-body-marker" });
    }
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "GET /api/v2/projects/project/branches 422 scopes rejected\n");
  assert.equal(run.err().includes("raw-body-marker"), false);
  assert.equal(run.migrated.length, 0);
});

test("a bad parent on an existing copy is left in place", async () => {
  const routed = script((input) => {
    if (pathname(input.url).endsWith("/files")) return response(200, [sqlFile()]);
    if (pathname(input.url).endsWith("/branches")) return response(200, { branches: [dev, prod, wire("br-pr-12", "preview/pr-12", "br-prod")] });
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "parent is not dev\n");
  assert.equal(deletes(routed.calls).length, 0);
  assert.equal(posts(routed.calls, "/branches").length, 0);
  assert.equal(run.migrated.length, 0);
});

test("close deletes the preview branch and its branch values, then a second close is a no-op", async () => {
  let branchThere = true;
  let envGone = false;
  const routed = script((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.endsWith("/branches")) {
      if (!branchThere) envGone = true;
      return response(200, { branches: branchThere ? [dev, prod, wire("br-pr-12", "preview/pr-12", "br-dev")] : [dev, prod] });
    }
    if (input.method === "DELETE" && pathName.includes("/branches/")) {
      branchThere = false;
      return response(404, "");
    }
    if (input.method === "GET" && pathName.endsWith("/sites/site")) return response(200, { account_id: "acct" });
    if (input.method === "GET" && pathName.includes("/env/")) {
      if (envGone) return response(404, { message: "missing" });
      const key = pathName.split("/env/")[1] ?? "";
      return response(200, { values: [
        { id: `val-${key}`, context: "branch", context_parameter: "cfg/widget" },
        { id: "val-prod", context: "production", context_parameter: "" },
      ] });
    }
    if (input.method === "DELETE" && pathName.includes("/value/")) return response(204, "");
    return undefined;
  });
  const run = harness(BASE, routed.http);
  assert.equal(await execute("close", run.io), 0);
  assert.equal(await execute("close", run.io), 0);
  assert.equal(run.err(), "");
  assert.deepEqual(proofLines(run.out()), ["preview/pr-12 removed DATABASE_URL", "preview/pr-12 removed APP_DB_LABEL"]);
  const removed = deletes(routed.calls);
  assert.equal(removed.some((call) => pathname(call.url) === "/api/v2/projects/project/branches/br-pr-12"), true);
  assert.equal(removed.some((call) => call.url.includes("br-dev") || call.url.includes("br-prod")), false);
  assert.equal(removed.some((call) => /\/env\/[^/]+$/.test(pathname(call.url))), false);
  assert.equal(removed.filter((call) => call.url.includes("/value/")).length, 2);
  assert.equal(removed.some((call) => call.url.includes("val-prod")), false);
});

test("sweep deletes a closed copy and leaves an open one and a missing one", async () => {
  const routed = script((input) => {
    const pathName = pathname(input.url);
    if (input.method === "GET" && pathName.endsWith("/branches")) {
      return response(200, { branches: [
        dev,
        prod,
        wire("br-closed", "preview/pr-3", "br-dev"),
        wire("br-open", "preview/pr-4", "br-dev"),
        wire("br-missing", "preview/pr-5", "br-dev"),
        wire("br-zero", "preview/pr-0", "br-dev"),
      ] });
    }
    const pull = /\/pulls\/([1-9]\d*)$/.exec(pathName);
    if (input.method === "GET" && pull !== null) {
      if (pull[1] === "3") return response(200, { state: "closed", head: { ref: "cfg/closed" } });
      if (pull[1] === "4") return response(200, { state: "open", head: { ref: "cfg/open" } });
      if (pull[1] === "5") return response(404, { message: "missing" });
    }
    if (input.method === "DELETE" && pathName.includes("/branches/")) return response(200, "");
    if (input.method === "GET" && pathName.endsWith("/sites/site")) return response(200, { account_slug: "team" });
    if (input.method === "GET" && pathName.includes("/env/")) {
      return response(200, { values: [
        { id: "val-closed", context: "branch", context_parameter: "cfg/closed" },
        { id: "val-open", context: "branch", context_parameter: "cfg/open" },
      ] });
    }
    if (input.method === "DELETE" && pathName.includes("/value/")) return response(200, "");
    return undefined;
  });
  const env = { ...BASE };
  delete env.FORK;
  delete env.PR_NUMBER;
  delete env.HEAD_REF;
  delete env.HEAD_SHA;
  const run = harness(env, routed.http);
  assert.equal(await execute("sweep", run.io), 0);
  assert.deepEqual(proofLines(run.out()), ["sweep preview/pr-3", "preview/pr-3 removed DATABASE_URL", "preview/pr-3 removed APP_DB_LABEL"]);
  const removed = deletes(routed.calls).map((call) => pathname(call.url));
  assert.deepEqual(removed.filter((item) => item.includes("/branches/")), ["/api/v2/projects/project/branches/br-closed"]);
  assert.equal(removed.some((item) => item.includes("br-dev") || item.includes("br-prod") || item.includes("br-open") || item.includes("br-missing")), false);
  const values = removed.filter((item) => item.includes("/value/val-closed"));
  assert.equal(values.length, 2);
  assert.equal(values.every((item) => item.includes("/accounts/team/")), true);
  assert.equal(removed.some((item) => item.includes("val-open")), false);
});

test("dev migrate applies db changes, skips other paths, and migrates an unknown range", async () => {
  const url = "postgres://owner:dev-secret@db.example.test/neondb";
  const db = harness({ CHANGED_PATHS: "db/a.sql\n", APP_DEV_DATABASE_URL: url }, script(() => undefined).http);
  assert.equal(await execute("dev-migrate", db.io), 0);
  assert.equal(db.out(), `::add-mask::${url}\n`);
  assert.equal(db.migrated[0]?.url, url);
  assert.equal(db.migrated[0]?.dir, path.join(repoRoot, "db"));
  const exact = harness({ CHANGED_PATHS: "db", APP_DEV_DATABASE_URL: url }, script(() => undefined).http);
  assert.equal(await execute("dev-migrate", exact.io), 0);
  assert.equal(exact.migrated.length, 1);
  const skip = harness({ CHANGED_PATHS: "server/a.ts\nui/a.ts\nnotes/db/a.sql" }, script(() => undefined).http);
  assert.equal(await execute("dev-migrate", skip.io), 0);
  assert.equal(skip.migrated.length, 0);
  assert.equal(skip.out(), "");
  const unknown = harness({ EVENT_BEFORE: "0".repeat(40), EVENT_SHA: HEAD, APP_DEV_DATABASE_URL: url }, script(() => undefined).http);
  assert.equal(await execute("dev-migrate", unknown.io), 0);
  assert.equal(unknown.migrated.length, 1);
  const cwd = mkdtempSync(path.join(tmpdir(), "db-diff-"));
  try {
    const failed = harness({ EVENT_BEFORE: "c".repeat(40), EVENT_SHA: HEAD, APP_DEV_DATABASE_URL: url }, script(() => undefined).http, { cwd });
    assert.equal(await execute("dev-migrate", failed.io), 0);
    assert.equal(failed.migrated.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a bad dev connection string is refused without writing it", async () => {
  const secret = "postgres://owner:dev-secret@db.example.test/neondb extra";
  const run = harness({ CHANGED_PATHS: "db/a.sql", APP_DEV_DATABASE_URL: secret }, script(() => undefined).http);
  assert.equal(await execute("dev-migrate", run.io), 1);
  assert.equal(run.err(), "refusing connection uri\n");
  assert.equal(run.out(), "");
  assert.equal(run.err().includes("dev-secret"), false);
  assert.equal(run.migrated.length, 0);
});

test("branch operation failure does not migrate", async () => {
  for (const status of ["failed", "error", "cancelled"]) {
    let polls = 0;
    const routed = script((input) => {
      const pathName = pathname(input.url);
      if (pathName.endsWith("/files")) return response(200, [sqlFile()]);
      if (input.method === "GET" && pathName.endsWith("/branches")) return response(200, { branches: [dev, prod] });
      if (input.method === "POST" && pathName.endsWith("/branches")) return response(201, { branch: wire("br-pr-12", "preview/pr-12", "br-dev"), operations: [{ id: "op-1" }] });
      if (pathName.includes("/operations/")) { polls += 1; return response(200, { operation: { status } }); }
      return undefined;
    });
    const run = harness(BASE, routed.http);
    assert.equal(await execute("copy", run.io), 1);
    assert.equal(run.err(), "branch operation failed\n");
    assert.equal(polls, 1);
    assert.equal(run.migrated.length, 0);
  }
});

test("a running operation is polled at most 30 times", async () => {
  let polls = 0;
  let sleeps = 0;
  const routed = script((input) => {
    const pathName = pathname(input.url);
    if (pathName.endsWith("/files")) return response(200, [sqlFile()]);
    if (input.method === "GET" && pathName.endsWith("/branches")) return response(200, { branches: [dev, prod] });
    if (input.method === "POST" && pathName.endsWith("/branches")) return response(201, { branch: wire("br-pr-12", "preview/pr-12", "br-dev"), operations: [{ id: "op-1" }] });
    if (pathName.includes("/operations/")) { polls += 1; return response(200, { operation: { status: "running" } }); }
    return undefined;
  });
  const run = harness(BASE, routed.http, { sleep: async () => { sleeps += 1; } });
  assert.equal(await execute("copy", run.io), 1);
  assert.equal(run.err(), "branch operation failed\n");
  assert.equal(polls, 30);
  assert.equal(sleeps, 29);
  assert.equal(run.migrated.length, 0);
});

test("fork refusal and a missing variable do not call the network", async () => {
  for (const command of ["copy", "close"]) {
    for (const fork of [undefined, "true", "False", ""]) {
      const env = { ...BASE };
      if (fork === undefined) delete env.FORK;
      else env.FORK = fork;
      const routed = script(() => { throw new Error("http"); });
      const run = harness(env, routed.http);
      assert.equal(await execute(command, run.io), 1);
      assert.equal(run.err(), "refusing a fork\n");
      assert.equal(routed.calls.length, 0);
    }
  }
  const env: NodeJS.ProcessEnv = { ...BASE, NEON_API_KEY: "super-secret-value" };
  delete env.PR_NUMBER;
  const routed = script(() => undefined);
  const missing = harness(env, routed.http);
  assert.equal(await execute("copy", missing.io), 1);
  assert.equal(missing.err(), "PR_NUMBER is required\n");
  assert.equal(missing.err().includes("super-secret-value"), false);
  assert.equal(routed.calls.length, 0);
  const badRepo = { ...BASE, GITHUB_REPOSITORY: "noslash" };
  const invalid = harness(badRepo, script(() => undefined).http);
  assert.equal(await execute("copy", invalid.io), 1);
  assert.equal(invalid.err(), "GITHUB_REPOSITORY is invalid\n");
  assert.equal(invalid.err().includes("noslash"), false);
  const unknown = harness(BASE, script(() => undefined).http);
  assert.equal(await execute("migrate", unknown.io), 1);
  assert.equal(unknown.err(), "unknown command\n");
});

test("workflow facts allow the copy workflows and keep neon off pull_request", () => {
  const readers = new Set(["db-copy.yml", "db-sweep.yml"]);
  const commands: Record<string, string> = {
    "db-copy.yml": "copy",
    "db-copy-close.yml": "close",
    "db-sweep.yml": "sweep",
    "db-dev-migrate.yml": "dev-migrate",
  };
  for (const name of Object.keys(commands)) {
    const source = readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8");
    const facts = workflowFacts(source);
    assert.deepEqual(judgeWorkflowPermissions(name, source), { ok: true });
    const manual = name === "db-sweep.yml";
    assert.equal(facts.events.every((event) => event === "pull_request_target" || event === "push" || event === "schedule" || (manual && event === "workflow_dispatch")), true);
    assert.equal(facts.events.includes("pull_request"), false);
    assert.deepEqual(facts.environments, ["neon"]);
    assert.equal(facts.grants.some((grant) => grant.scope === "pull-requests"), readers.has(name));
    assert.equal(source.includes("workflow_dispatch"), manual);
    if (manual) {
      assert.equal(facts.events.includes("schedule"), true);
      assert.equal(facts.events.includes("workflow_dispatch"), true);
      assert.match(source, /cron: "0 9 \* \* \*"/);
    }
    assert.equal(source.includes("npm test"), false);
    assert.equal(source.split("permissions:").length - 1, 1);
    assert.match(source, /ref: main/);
    assert.match(source, /persist-credentials: false/);
    assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
    assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
    assert.match(source, /runs-on: ubuntu-latest/);
    assert.match(source, /timeout-minutes: 15/);
    assert.match(source, new RegExp(`npx tsx \\.github/db-copies/run\\.ts ${commands[name]}`));
    for (const line of source.split("\n")) {
      if (line.includes("${{")) assert.match(line, /"[^"\n]*\$\{\{[^}]+\}\}[^"\n]*"/);
    }
  }
  const dev = readFileSync(path.join(repoRoot, ".github/workflows/db-dev-migrate.yml"), "utf8");
  assert.match(dev, /fetch-depth: "0"/);
  assert.match(dev, /paths: \["db\/\*\*"\]/);
  const copy = readFileSync(path.join(repoRoot, ".github/workflows/db-copy.yml"), "utf8");
  assert.match(copy, /cancel-in-progress: true/);
  assert.match(copy, /types: \[opened, synchronize, reopened\]/);
});

function spawnCli(args: readonly string[], extra: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const name of ["NEON_API_KEY", "NETLIFY_AUTH_TOKEN", "GITHUB_TOKEN", "APP_DEV_DATABASE_URL", "DATABASE_URL", "FORK", "CHANGED_PATHS", "PR_NUMBER", "EVENT_BEFORE", "EVENT_SHA"]) {
    if (!(name in extra)) delete env[name];
  }
  return spawnSync("npx", ["tsx", ".github/db-copies/run.ts", ...args], { cwd: repoRoot, encoding: "utf8", env, timeout: 20000 });
}

function proofLines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "" && !line.startsWith("::add-mask::"));
}

function assertNoUriOrSecret(text: string): void {
  assert.equal(text.includes("postgres://"), false, text);
  assert.equal(text.includes("postgresql://"), false, text);
  assert.equal(text.includes(DIRECT), false, text);
  assert.equal(text.includes(POOLED), false, text);
  assert.equal(text.includes("direct-secret"), false, text);
  assert.equal(text.includes("pooled-secret"), false, text);
  assert.equal(text.includes("neon-api-key-value"), false, text);
  assert.equal(text.includes("netlify-token-value"), false, text);
  assert.equal(text.includes("github-token-value"), false, text);
}

test("the cli refuses a fork and skips a ui-only dev migrate without the dev url", () => {
  const fork = spawnCli(["copy"], { FORK: "true" });
  assert.equal(fork.status, 1);
  assert.equal(fork.stderr, "refusing a fork\n");
  const skipped = spawnCli(["dev-migrate"], { CHANGED_PATHS: "ui/a.ts" });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stderr, "");
});

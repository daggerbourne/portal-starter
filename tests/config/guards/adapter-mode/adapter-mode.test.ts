import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  changesFromEnv,
  guardDepth,
  judgeRepository,
  type ChangeList,
} from "../../../../.github/guards/adapter-mode.js";

const repoRoot = path.join(import.meta.dirname, "../../../..");
const guardScript = path.join(repoRoot, ".github/guards/adapter-mode.ts");
const permissionsScript = path.join(repoRoot, ".github/guards/check.ts");
const FULL_IF = "success() && steps.plan.outputs.depth == 'full'";
const MISSING_MODE = ".github/workflows/ci.yml: ci job is missing MODE=mock";
const UNREADABLE = ".github/workflows/ci.yml: unreadable workflow";
const MOCK_CI = "jobs:\n  ci:\n    env:\n      MODE: mock\n";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function withTree(files: Readonly<Record<string, string>>, run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "adapter-mode-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const full = path.join(dir, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function messages(files: Readonly<Record<string, string>>): readonly string[] {
  let found: readonly string[] = [];
  withTree({ ".github/workflows/ci.yml": MOCK_CI, ...files }, (dir) => {
    const judgment = judgeRepository(dir);
    assert.equal(judgment.ok, false);
    if (!judgment.ok) found = judgment.messages;
  });
  return found;
}

function passes(files: Readonly<Record<string, string>>): void {
  withTree({ ".github/workflows/ci.yml": MOCK_CI, ...files }, (dir) => {
    assert.deepEqual(judgeRepository(dir), { ok: true });
  });
}

test("a file outside the adapter gate that calls fetch fails and names the file", () => {
  assert.deepEqual(messages({ "app/send.ts": fixture("fetch.txt") }), ["app/send.ts:2: fetch"]);
});

test("imports of node:http, https, net, undici, and axios fail and name the call", () => {
  const calls = [
    ["import-node-http.txt", "lib/http.ts:1: import node:http"],
    ["import-https.txt", "lib/https.ts:1: import https"],
    ["import-net.txt", "lib/net.ts:1: import net"],
    ["import-undici.txt", "lib/undici.ts:1: import undici"],
    ["import-axios.txt", "lib/axios.ts:1: import axios"],
  ] as const;
  for (const [name, message] of calls) {
    assert.deepEqual(messages({ [message.slice(0, message.indexOf(":"))]: fixture(name) }), [message]);
  }
});

test("the same calls inside adapters and the adapter gate pass", () => {
  const sample = `${fixture("fetch.txt")}\n${fixture("import-node-http.txt")}\n${fixture("import-axios.txt")}`;
  passes({
    "adapters/entra/transport.ts": sample,
    "core/adapter-gate/transport.ts": sample,
  });
});

test("dynamic import and require of a network client fail", () => {
  assert.deepEqual(messages({ "app/dynamic.ts": fixture("dynamic-undici.txt") }), [
    "app/dynamic.ts:2: import() undici",
  ]);
  assert.deepEqual(messages({ "app/require-axios.ts": fixture("require-axios.txt") }), [
    "app/require-axios.ts:1: require axios",
  ]);
  assert.deepEqual(messages({ "app/require-http.ts": fixture("require-node-http.txt") }), [
    "app/require-http.ts:1: require node:http",
  ]);
});

test("template specifiers require(`axios`) and import(`undici`) fail and name the file", () => {
  assert.deepEqual(messages({ "app/template.ts": fixture("template-specifier.txt") }), [
    "app/template.ts:1: require axios",
    "app/template.ts:4: import() undici",
  ]);
});

test("package subpaths axios/ and axios/dist/axios.js fail and name the file", () => {
  assert.deepEqual(messages({ "app/subpath.ts": fixture("package-subpath.txt") }), [
    "app/subpath.ts:1: import axios/",
    "app/subpath.ts:2: import axios/dist/axios.js",
  ]);
});

test("createRequire(import.meta.url)(\"axios\") fails and names the file", () => {
  assert.deepEqual(messages({ "app/create-require.ts": fixture("create-require.txt") }), [
    "app/create-require.ts:3: createRequire",
  ]);
});

test("process.getBuiltinModule(\"http\") fails and names the file", () => {
  assert.deepEqual(messages({ "app/builtin.ts": fixture("builtin-module.txt") }), [
    "app/builtin.ts:1: getBuiltinModule http",
  ]);
});

test("globalThis['fetch'] and an aliased fetch fail and name the file", () => {
  assert.deepEqual(messages({ "app/alias.ts": fixture("fetch-alias.txt") }), [
    "app/alias.ts:1: fetch",
    "app/alias.ts:4: fetch",
  ]);
});

test("a line-continued fetch( call fails and names the file", () => {
  assert.deepEqual(messages({ "app/continued.ts": fixture("fetch-continued.txt") }), [
    "app/continued.ts:3: fetch",
  ]);
});

test("a string-built require(\"ax\" + \"ios\") fails and names the file", () => {
  assert.deepEqual(messages({ "app/built.ts": fixture("require-built.txt") }), [
    "app/built.ts:1: require non-literal",
  ]);
});

test("node:pg, Axios, and HTTP specifiers fail and name the file", () => {
  assert.deepEqual(messages({ "app/case.ts": fixture("specifier-case.txt") }), [
    "app/case.ts:1: import node:pg",
    "app/case.ts:2: import Axios",
    "app/case.ts:3: import HTTP",
  ]);
  passes({ "db/store.ts": 'import pg from "node:pg";\nexport const client = pg;\n' });
});

test("a dynamic import of a loader call passes", () => {
  passes({
    "server/gallery/gallery.mjs": "export const imported = await import(pathToFileURL(file).href);\n",
  });
});

test("tls, http2, node-fetch, and got are network clients too", () => {
  assert.deepEqual(messages({ "app/clients.ts": fixture("more-clients.txt") }), [
    "app/clients.ts:1: import tls",
    "app/clients.ts:2: import http2",
    "app/clients.ts:3: import node-fetch",
    "app/clients.ts:4: import got",
  ]);
});

test("a fetch inside a comment, a string, or a template is not a call", () => {
  passes({
    "app/note.ts": fixture("comment-string.txt"),
    "app/sample.ts": fixture("template-text.txt"),
    "app/declared.ts": fixture("function-fetch.txt"),
  });
});

test("a fetch inside a template expression fails", () => {
  assert.deepEqual(messages({ "app/send.ts": fixture("template-expr.txt") }), ["app/send.ts:2: fetch"]);
});

test("pg is allowed under db, scripts, server, and tests", () => {
  passes({
    "db/migrate.ts": fixture("pg.txt"),
    "scripts/migrate.ts": fixture("pg.txt"),
    "server/admin/shell.ts": fixture("pg.txt"),
    "server/auth/staff-directory.ts": fixture("pg.txt"),
    "tests/db/admin-shell.test.ts": fixture("pg.txt"),
    "tests/db/migrate.test.ts": fixture("pg.txt"),
  });
});

test("pg import, require, and dynamic import fail outside those folders", () => {
  assert.deepEqual(messages({ "app/store.ts": fixture("pg.txt") }), ["app/store.ts:1: import pg"]);
  assert.deepEqual(messages({ "core/store.ts": fixture("pg.txt") }), ["core/store.ts:1: import pg"]);
  assert.deepEqual(messages({ "app/require-pg.ts": 'const client = require("pg");\n' }), [
    "app/require-pg.ts:1: require pg",
  ]);
  assert.deepEqual(messages({ "app/load.ts": 'export const load = () => import("pg");\n' }), [
    "app/load.ts:1: import() pg",
  ]);
});

test("server and tests may import pg and still may not call fetch", () => {
  assert.deepEqual(messages({ "server/admin/shell.ts": fixture("fetch.txt") }), [
    "server/admin/shell.ts:2: fetch",
  ]);
  assert.deepEqual(messages({ "tests/db/call.test.ts": fixture("fetch.txt") }), [
    "tests/db/call.test.ts:2: fetch",
  ]);
});

test("a direct fetch in server/auth/wire.ts fails", () => {
  assert.deepEqual(messages({ "server/auth/wire.ts": fixture("fetch.txt") }), [
    "server/auth/wire.ts:2: fetch",
  ]);
  assert.deepEqual(messages({ "server/auth/transport.ts": fixture("fetch.txt") }), [
    "server/auth/transport.ts:2: fetch",
  ]);
  assert.deepEqual(messages({ "server/auth/wire.tsx": fixture("fetch.txt") }), [
    "server/auth/wire.tsx:2: fetch",
  ]);
  assert.deepEqual(messages({ "server/auth/wire.ts/extra.ts": fixture("fetch.txt") }), [
    "server/auth/wire.ts/extra.ts:2: fetch",
  ]);
});

test("the scan skips .github and .cursor and still checks a near miss", () => {
  const sample = fixture("fetch.txt");
  passes({
    ".github/verdicts/check.ts": sample,
    ".cursor/skills/verify-app/run.mjs": sample,
  });
  assert.deepEqual(messages({ "github/check.ts": sample }), ["github/check.ts:2: fetch"]);
  assert.deepEqual(messages({ "cursor/run.mjs": sample }), ["cursor/run.mjs:2: fetch"]);
  assert.deepEqual(messages({ "app/.github/check.ts": sample }), ["app/.github/check.ts:2: fetch"]);
  assert.deepEqual(messages({ "app/.cursor/run.mjs": sample }), ["app/.cursor/run.mjs:2: fetch"]);
  assert.deepEqual(messages({ ".github.ts": sample }), [".github.ts:2: fetch"]);
});

test("the fixture directory is skipped and a file beside it is not", () => {
  const sample = fixture("fetch.txt");
  passes({ "tests/config/guards/adapter-mode/fixtures/call.ts": sample });
  assert.deepEqual(messages({ "tests/config/guards/adapter-mode/call.ts": sample }), [
    "tests/config/guards/adapter-mode/call.ts:2: fetch",
  ]);
  assert.deepEqual(messages({ "tests/other/fixtures/call.ts": sample }), [
    "tests/other/fixtures/call.ts:2: fetch",
  ]);
  assert.deepEqual(messages({ "tests/config/guards/adapter-mode/fixtures.ts": sample }), [
    "tests/config/guards/adapter-mode/fixtures.ts:2: fetch",
  ]);
});

test("a ci.yml without MODE mock on the ci job fails", () => {
  withTree({ ".github/workflows/ci.yml": fixture("ci-without-mode.txt") }, (dir) => {
    assert.deepEqual(judgeRepository(dir), { ok: false, messages: [MISSING_MODE] });
  });
  const real = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const stripped = real.replace("\n      MODE: mock\n", "\n");
  assert.notEqual(stripped, real);
  withTree({ ".github/workflows/ci.yml": stripped }, (dir) => {
    assert.deepEqual(judgeRepository(dir), { ok: false, messages: [MISSING_MODE] });
  });
});

test("the ci job on main sets MODE to mock", () => {
  const real = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  withTree({ ".github/workflows/ci.yml": real }, (dir) => {
    assert.deepEqual(judgeRepository(dir), { ok: true });
  });
});

test("MODE must be the mock scalar on the ci job", () => {
  const cases = [
    ["jobs:\n  ci:\n    env:\n      MODE: live\n", MISSING_MODE],
    ["jobs:\n  ci:\n    env:\n      MODE: \"mock\"\n", ""],
    ["jobs:\n  ci:\n    env:\n      MODE: 'mock'\n", ""],
    ["jobs:\n  ci:\n    env: { MODE: mock }\n", ""],
    ["jobs:\n  ci:\n    env: { MODE: live }\n", MISSING_MODE],
    ["env:\n  MODE: mock\njobs:\n  ci:\n    runs-on: ubuntu-latest\n", MISSING_MODE],
    ["jobs:\n  other:\n    env:\n      MODE: mock\n", MISSING_MODE],
    ["jobs:\n  ci:\n    env:\n      MODE: ${{ 'mock' }}\n", MISSING_MODE],
    ["jobs:\n  ci:\n\tenv:\n\t  MODE: mock\n", UNREADABLE],
  ] as const;
  for (const [source, message] of cases) {
    withTree({ ".github/workflows/ci.yml": source }, (dir) => {
      const judgment = judgeRepository(dir);
      if (message === "") {
        assert.deepEqual(judgment, { ok: true });
      } else {
        assert.deepEqual(judgment, { ok: false, messages: [message] });
      }
    });
  }
});

test("guard depth is markdown only when every path ends in .md", () => {
  const cases: readonly { readonly changes: ChangeList; readonly depth: "markdown-only" | "full" }[] = [
    { changes: { kind: "paths", paths: ["README.md", "specs/M00-foundation.md"] }, depth: "markdown-only" },
    { changes: { kind: "paths", paths: ["README.md", "app.ts"] }, depth: "full" },
    { changes: { kind: "paths", paths: [] }, depth: "full" },
    { changes: { kind: "unknown" }, depth: "full" },
    { changes: { kind: "paths", paths: ["note.MD"] }, depth: "full" },
  ];
  for (const entry of cases) {
    assert.equal(guardDepth(entry.changes), entry.depth);
  }
  assert.deepEqual(changesFromEnv({ EVENT_NAME: "other" }), { kind: "unknown" });
});

test("plan writes markdown-only and the check is skipped without npm ci", () => {
  const source = readFileSync(path.join(repoRoot, ".github/workflows/guards.yml"), "utf8");
  const jobAt = source.indexOf("\n  adapter-mode:\n");
  assert.notEqual(jobAt, -1);
  const job = source.slice(jobAt);
  assert.equal(job.includes("npm ci"), false);
  assert.equal(job.includes("environment:"), false);
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /timeout-minutes: 15/);
  assert.match(job, /fetch-depth: "0"/);
  assert.match(job, /persist-credentials: false/);
  const planAt = job.indexOf("- name: plan\n");
  const stepAt = job.indexOf("- name: adapter-mode\n");
  assert.ok(planAt !== -1 && stepAt > planAt);
  const plan = job.slice(planAt, stepAt);
  const step = job.slice(stepAt);
  assert.equal(plan.includes("if:"), false);
  assert.match(plan, /id: plan/);
  assert.match(plan, /node --experimental-strip-types \.github\/guards\/adapter-mode\.ts plan/);
  assert.ok(step.includes(`if: "${FULL_IF}"`));
  assert.match(step, /node --experimental-strip-types \.github\/guards\/adapter-mode\.ts\n/);
  assert.equal(step.includes("adapter-mode.ts plan"), false);
});

test("a markdown diff plans markdown-only", () => {
  withRepo((dir) => {
    const base = commit(dir, "README.md", "one\n");
    const head = commit(dir, "README.md", "two\n");
    const outputPath = path.join(dir, "github-output.txt");
    writeFileSync(outputPath, "");
    const planned = spawnGuard(dir, ["plan"], {
      GITHUB_OUTPUT: outputPath,
      EVENT_NAME: "pull_request",
      PR_BASE: base,
      HEAD_SHA: head,
    });
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal(readFileSync(outputPath, "utf8"), "depth=markdown-only\n");
    const code = commit(dir, "app.ts", "export const ready = true;\n");
    writeFileSync(outputPath, "");
    const again = spawnGuard(dir, ["plan"], {
      GITHUB_OUTPUT: outputPath,
      EVENT_NAME: "push",
      EVENT_BEFORE: head,
      HEAD_SHA: code,
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(outputPath, "utf8"), "depth=full\n");
    const missing = spawnGuard(dir, ["plan"], { EVENT_NAME: "pull_request", PR_BASE: base, HEAD_SHA: head });
    assert.equal(missing.status, 1);
  });
});

test("the command fails on a tree that calls fetch", () => {
  withTree(
    {
      ".github/workflows/ci.yml": MOCK_CI,
      "app/send.ts": fixture("fetch.txt"),
    },
    (dir) => {
      const run = spawnGuard(dir, [], {});
      assert.equal(run.status, 1);
      assert.match(run.stderr, /app\/send\.ts:2: fetch/);
    },
  );
});

test("ci-permissions still passes on guards.yml", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", permissionsScript, "ci-permissions"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
});

function withRepo(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "adapter-mode-git-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@example.test"]);
    git(dir, ["config", "user.name", "test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function commit(dir: string, file: string, body: string): string {
  const absolute = path.join(dir, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", file]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

function git(dir: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout;
}

function spawnGuard(
  dir: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { readonly status: number | null; readonly stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", guardScript, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

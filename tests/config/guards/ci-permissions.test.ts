import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  changesFromEnv,
  guardDepth,
  judgeWorkflowPermissions,
  workflowFacts,
  type ChangeList,
  type PermissionJudgment,
  type WorkflowFacts,
} from "../../../.github/guards/check.js";

const repoRoot = path.join(import.meta.dirname, "../../..");
const guardScript = path.join(repoRoot, ".github/guards/check.ts");
const workflows = path.join(repoRoot, ".github/workflows");

const CONTENTS_READ: WorkflowFacts = {
  events: ["pull_request", "push"],
  grants: [{ scope: "contents", access: "read" }],
  environments: [],
};

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");
}

function workflow(name: string): string {
  return readFileSync(path.join(workflows, name), "utf8");
}

function judge(fileName: string, source: string): PermissionJudgment {
  return judgeWorkflowPermissions(fileName, source);
}

test("workflows on main keep contents read", () => {
  assert.deepEqual(workflowFacts(workflow("ci.yml")), CONTENTS_READ);
  assert.deepEqual(judge("ci.yml", workflow("ci.yml")), { ok: true });
  assert.deepEqual(workflowFacts(workflow("scope.yml")), {
    events: ["pull_request"],
    grants: [{ scope: "contents", access: "read" }],
    environments: [],
  });
  assert.deepEqual(judge("scope.yml", workflow("scope.yml")), { ok: true });
  assert.deepEqual(workflowFacts(workflow("verdicts.yml")), {
    events: ["pull_request", "pull_request_review", "issue_comment"],
    grants: [
      { scope: "contents", access: "read" },
      { scope: "pull-requests", access: "read" },
    ],
    environments: [],
  });
  assert.deepEqual(judge("verdicts.yml", workflow("verdicts.yml")), { ok: true });
});

test("verdicts may read pull requests and another workflow may not", () => {
  const source = fixture("pull-requests-read");
  assert.deepEqual(judge("verdicts.yml", source), { ok: true });
  assert.deepEqual(judge("copy.yml", source), {
    ok: false,
    reasons: ["grant pull-requests read"],
  });
});

test("a wider token fails", () => {
  assert.deepEqual(judge("bad.yml", fixture("contents-write")), {
    ok: false,
    reasons: ["grant contents write"],
  });
  assert.deepEqual(judge("bad.yml", fixture("pull-requests-write")), {
    ok: false,
    reasons: ["grant pull-requests write"],
  });
  assert.deepEqual(judge("bad.yml", fixture("write-all")), {
    ok: false,
    reasons: ["grant write-all"],
  });
  assert.deepEqual(judge("bad.yml", fixture("job-write")), {
    ok: false,
    reasons: ["grant contents write"],
  });
  assert.deepEqual(judge("bad.yml", fixture("missing-permissions")), {
    ok: false,
    reasons: ["permissions are missing"],
  });
  assert.deepEqual(workflowFacts(fixture("flow-permissions")), {
    events: ["push"],
    grants: [{ scope: "contents", access: "read" }],
    environments: [],
  });
  assert.deepEqual(judge("bad.yml", fixture("flow-permissions")), { ok: true });
  assert.deepEqual(judge("bad.yml", fixture("tab")), {
    ok: false,
    reasons: ["unreadable workflow"],
  });
});

test("pull_request refuses the neon environment", () => {
  assert.deepEqual(judge("copy.yml", fixture("neon-pull-request")), {
    ok: false,
    reasons: ["pull_request names environment neon"],
  });
  assert.deepEqual(judge("copy.yml", fixture("neon-name")), {
    ok: false,
    reasons: ["pull_request names environment neon"],
  });
  assert.deepEqual(judge("copy.yml", fixture("neon-and-missing")), {
    ok: false,
    reasons: ["permissions are missing", "pull_request names environment neon"],
  });
  assert.deepEqual(judge("copy.yml", fixture("push-neon")), { ok: true });
  assert.deepEqual(judge("db-copy.yml", fixture("target-neon")), { ok: true });
  assert.deepEqual(workflowFacts(fixture("target-neon")), {
    events: ["pull_request_target"],
    grants: [{ scope: "contents", access: "read" }],
    environments: ["neon"],
  });
});

test("pull_request refuses neon by case, padding, or expression", () => {
  const expression = "${{ 'neon' }}";
  const jobs = [
    "    environment: Neon",
    "    environment: NEON",
    "    environment: { name: Neon }",
    '    environment: " neon "',
    `    environment: ${expression}`,
    `    environment: { name: "${expression}" }`,
  ];
  for (const job of jobs) {
    const source = `name: bad\non: pull_request\npermissions:\n  contents: read\njobs:\n  bad:\n${job}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    assert.deepEqual(judge("bad.yml", source), {
      ok: false,
      reasons: ["pull_request names environment neon"],
    });
    withRepo((dir) => {
      const workflowDir = path.join(dir, ".github/workflows");
      mkdirSync(workflowDir, { recursive: true });
      writeFileSync(path.join(workflowDir, "bad.yml"), source);
      const run = spawnGuard(dir, "ci-permissions", {});
      assert.equal(run.status, 1, run.stderr);
      assert.match(run.stderr, /bad\.yml: pull_request names environment neon/);
    });
  }
});

const PUSH_WRITE: WorkflowFacts = {
  events: ["push"],
  grants: [{ scope: "contents", access: "write" }],
  environments: [],
};

const PUSH_READ_AND_WRITE: WorkflowFacts = {
  events: ["push"],
  grants: [
    { scope: "contents", access: "read" },
    { scope: "contents", access: "write" },
  ],
  environments: [],
};

const PULL_REQUEST_NEON: WorkflowFacts = {
  events: ["pull_request"],
  grants: [{ scope: "contents", access: "read" }],
  environments: ["neon"],
};

test("a quoted contents key granting write fails", () => {
  assertRejected("quoted-contents-write", PUSH_WRITE, "grant contents write");
});

test("a quoted job permissions key granting write fails", () => {
  assertRejected("quoted-job-permissions", PUSH_READ_AND_WRITE, "grant contents write");
});

test("a quoted on key with pull_request and neon fails", () => {
  assertRejected("quoted-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a flow environment mapping named neon fails", () => {
  assertRejected("flow-environment-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a flow on mapping for pull_request and neon fails", () => {
  assertRejected("flow-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a four-space on child with pull_request and neon fails", () => {
  assertRejected("deep-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a nested flow trigger is the event name", () => {
  assert.deepEqual(workflowFacts(fixture("nested-flow-on")), {
    events: ["pull_request"],
    grants: [{ scope: "contents", access: "read" }],
    environments: [],
  });
  assert.deepEqual(judge("bad.yml", fixture("nested-flow-on")), { ok: true });
});

test("a block trigger or environment is judged", () => {
  assertRejected("sequence-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
  assertRejected("block-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
  assertRejected("block-environment-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("an alias or merge key fails closed", () => {
  for (const name of ["alias-on-neon", "alias-environment-neon", "merge-key"]) {
    assert.deepEqual(judge("bad.yml", fixture(name)), { ok: false, reasons: ["unreadable workflow"] });
  }
});

const JOB_WRITE: WorkflowFacts = {
  events: [],
  grants: [
    { scope: "contents", access: "read" },
    { scope: "contents", access: "write" },
  ],
  environments: [],
};

test("a flow-mapping job granting write fails", () => {
  assertRejected("flow-job-write", JOB_WRITE, "grant contents write");
});

test("a flow-mapping jobs map granting write fails", () => {
  assertRejected("flow-jobs-write", JOB_WRITE, "grant contents write");
});

test("a flow-mapping job naming neon fails", () => {
  assertRejected("flow-job-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a yaml string tag on the trigger and environment fails", () => {
  assertRejected("tag-on-neon", PULL_REQUEST_NEON, "pull_request names environment neon");
});

test("a yaml string tag on a permission value is that access", () => {
  assertRejected("tag-contents-write", PUSH_WRITE, "grant contents write");
});

test("guard depth follows the diff", () => {
  const cases: readonly { readonly changes: ChangeList; readonly depth: "markdown-only" | "full" }[] = [
    { changes: { kind: "paths", paths: ["README.md", "specs/M00-foundation.md"] }, depth: "markdown-only" },
    { changes: { kind: "paths", paths: ["README.md", "core/app.ts"] }, depth: "full" },
    { changes: { kind: "paths", paths: [] }, depth: "full" },
    { changes: { kind: "unknown" }, depth: "full" },
  ];
  for (const entry of cases) {
    assert.equal(guardDepth(entry.changes), entry.depth);
  }
});

test("a markdown diff plans markdown-only and a code diff plans full", () => {
  withRepo((dir) => {
    const base = commit(dir, "README.md", "one\n");
    const markdown = commit(dir, "README.md", "two\n");
    assert.deepEqual(changesFromEnv({ EVENT_NAME: "pull_request", PR_BASE: base, HEAD_SHA: markdown }, dir), {
      kind: "paths",
      paths: ["README.md"],
    });
    const code = commit(dir, "app.ts", "export const ready = true;\n");
    assert.deepEqual(changesFromEnv({ EVENT_NAME: "push", EVENT_BEFORE: markdown, HEAD_SHA: code }, dir), {
      kind: "paths",
      paths: ["app.ts"],
    });
    assert.deepEqual(changesFromEnv({ EVENT_NAME: "push", EVENT_BEFORE: "0".repeat(40), HEAD_SHA: code }, dir), {
      kind: "unknown",
    });
    assert.equal(guardDepth(changesFromEnv({ EVENT_NAME: "pull_request", PR_BASE: base, HEAD_SHA: markdown }, dir)), "markdown-only");
    assert.equal(guardDepth(changesFromEnv({ EVENT_NAME: "push", EVENT_BEFORE: markdown, HEAD_SHA: code }, dir)), "full");
  });
});

test("plan writes the depth and refuses a missing output file", () => {
  withRepo((dir) => {
    const base = commit(dir, "README.md", "one\n");
    const head = commit(dir, "README.md", "two\n");
    const outputPath = path.join(dir, "github-output.txt");
    writeFileSync(outputPath, "");
    const planned = spawnGuard(dir, "plan", {
      GITHUB_OUTPUT: outputPath,
      EVENT_NAME: "pull_request",
      EVENT_BEFORE: "0".repeat(40),
      PR_BASE: base,
      HEAD_SHA: head,
    });
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal(readFileSync(outputPath, "utf8"), "depth=markdown-only\n");
    const missing = spawnGuard(dir, "plan", {
      EVENT_NAME: "pull_request",
      PR_BASE: base,
      HEAD_SHA: head,
    });
    assert.equal(missing.status, 1);
  });
});

test("ci-permissions exits 0 on this repository", () => {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", guardScript, "ci-permissions"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
});

test("ci-permissions exits 1 when a workflow widens its token", () => {
  withRepo((dir) => {
    const workflowDir = path.join(dir, ".github/workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "bad.yml"), fixture("contents-write"));
    const run = spawnGuard(dir, "ci-permissions", {});
    assert.equal(run.status, 1);
    assert.match(run.stderr, /bad\.yml: grant contents write/);
  });
});

function assertRejected(name: string, facts: WorkflowFacts, reason: string): void {
  const source = fixture(name);
  assert.deepEqual(workflowFacts(source), facts);
  assert.deepEqual(judge("bad.yml", source), { ok: false, reasons: [reason] });
  withRepo((dir) => {
    const workflowDir = path.join(dir, ".github/workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(path.join(workflowDir, "bad.yml"), source);
    const run = spawnGuard(dir, "ci-permissions", {});
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, new RegExp(`bad\\.yml: ${reason}`));
  });
}

function withRepo(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "app-guards-"));
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
  command: string,
  env: NodeJS.ProcessEnv,
): { readonly status: number | null; readonly stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", guardScript, command], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

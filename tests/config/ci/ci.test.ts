import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatPlanOutputs,
  planCiJob,
  type ChangeList,
  type CiJobPlan,
} from "../../../.github/ci/ci.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const ciScript = path.join(repoRoot, ".github/ci/ci.ts");
const workflowPath = path.join(repoRoot, ".github/workflows/ci.yml");
const FULL_IF = "success() && steps.plan.outputs.depth == 'full'";
const MIGRATE_IF =
  "success() && steps.plan.outputs.depth == 'full' && steps.plan.outputs.run_migrate == 'true'";
const CHECKOUT_PIN =
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE_PIN =
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const TEST_SCRIPT =
  'node --input-type=module -e "import {globSync} from \'node:fs\'; import {spawnSync} from \'node:child_process\'; const files = globSync(\'tests/**/*.test.ts\').sort(); process.stdout.write(files.join(\'\\n\')+\'\\n\'); const run = spawnSync(\'tsx\', [\'--test\', ...files], {stdio:\'inherit\'}); process.exit(run.status ?? 1);"';
const SECRET_SCAN = [
  "#!/bin/bash",
  "set -euo pipefail",
  "version=8.30.1",
  "sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  'work="${RUNNER_TEMP:-$(mktemp -d)}"',
  'archive="${work}/gitleaks.tar.gz"',
  'source_dir="${GITHUB_WORKSPACE:-.}"',
  'curl -fsSL -o "${archive}" "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz"',
  'echo "${sha256}  ${archive}" | sha256sum -c -',
  'tar -xzf "${archive}" -C "${work}" gitleaks',
  '"${work}/gitleaks" detect --source "${source_dir}" --redact --no-banner --exit-code 1',
  "",
].join("\n");
const MARKDOWN_OUTPUT = "depth=markdown-only\nrun_migrate=false\n";
const FULL_SKIP_OUTPUT = "depth=full\nrun_migrate=false\n";
const FULL_MIGRATE_OUTPUT = "depth=full\nrun_migrate=true\n";
const ZERO_SHA = "0".repeat(40);
const MIGRATE_MANIFEST = { scripts: { migrate: "tsx db/migrate.ts" } };

type YamlValue =
  | string
  | number
  | boolean
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue };

type PolicyExpect =
  | { readonly kind: "plan"; readonly plan: CiJobPlan }
  | { readonly kind: "throw" };

type PolicyCase = {
  readonly name: string;
  readonly changes: ChangeList;
  readonly manifest: unknown;
  readonly expect: PolicyExpect;
};

type SourceLine = {
  readonly indent: number;
  readonly text: string;
};

type StepClaim = {
  readonly name: string;
  readonly keys: readonly string[];
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
};

function paths(items: readonly string[]): ChangeList {
  return { kind: "paths", paths: items };
}

function planned(
  name: string,
  changes: ChangeList,
  manifest: unknown,
  plan: CiJobPlan,
): PolicyCase {
  return { name, changes, manifest, expect: { kind: "plan", plan } };
}

function rejected(
  name: string,
  changes: ChangeList,
  manifest: unknown,
): PolicyCase {
  return { name, changes, manifest, expect: { kind: "throw" } };
}

const UNKNOWN: ChangeList = { kind: "unknown" };

const POLICY_CASES: readonly PolicyCase[] = [
  planned("markdown list", paths(["specs/M00-foundation.md", "README.md"]), MIGRATE_MANIFEST, { depth: "markdown-only" }),
  planned("mixed list", paths(["README.md", "package.json"]), { scripts: {} }, { depth: "full", runMigrate: false }),
  planned("empty list", paths([]), MIGRATE_MANIFEST, { depth: "full", runMigrate: true }),
  planned("unknown", UNKNOWN, MIGRATE_MANIFEST, { depth: "full", runMigrate: true }),
  planned("note.MD", paths(["note.MD"]), MIGRATE_MANIFEST, { depth: "full", runMigrate: true }),
  planned("notes.md.bak", paths(["notes.md.bak"]), MIGRATE_MANIFEST, { depth: "full", runMigrate: true }),
  planned("dir.md/file.ts", paths(["dir.md/file.ts"]), MIGRATE_MANIFEST, { depth: "full", runMigrate: true }),
  planned("empty migrate string", paths(["hello.html"]), { scripts: { migrate: "" } }, { depth: "full", runMigrate: false }),
  planned("missing scripts", UNKNOWN, {}, { depth: "full", runMigrate: false }),
  planned("missing migrate", UNKNOWN, { scripts: {} }, { depth: "full", runMigrate: false }),
  planned("Migrate key", paths(["hello.html"]), { scripts: { Migrate: "tsx db/migrate.ts" } }, { depth: "full", runMigrate: false }),
  planned("markdown ignores a bad manifest", paths(["README.md"]), [], { depth: "markdown-only" }),
  rejected("migrate number throws", paths(["hello.html"]), { scripts: { migrate: 1 } }),
  rejected("scripts array throws", UNKNOWN, { scripts: [] }),
  rejected("scripts null throws", UNKNOWN, { scripts: null }),
  rejected("manifest array throws", UNKNOWN, []),
  rejected("manifest null throws", UNKNOWN, null),
];

const STEP_CLAIMS: readonly StepClaim[] = [
  { name: "checkout", keys: ["name", "uses", "with"], uses: CHECKOUT_PIN },
  { name: "setup node", keys: ["name", "uses", "with"], uses: SETUP_NODE_PIN },
  { name: "plan", keys: ["name", "id", "run", "env"], run: "node .github/ci/ci.ts" },
  { name: "secret scan", keys: ["name", "if", "run"], if: FULL_IF, run: "bash .github/ci/secret-scan.sh" },
  { name: "npm cache", keys: ["name", "if", "uses", "with"], if: FULL_IF, uses: SETUP_NODE_PIN },
  { name: "install", keys: ["name", "if", "run"], if: FULL_IF, run: "npm ci" },
  { name: "lint", keys: ["name", "if", "run"], if: FULL_IF, run: "npm run lint" },
  { name: "typecheck", keys: ["name", "if", "run"], if: FULL_IF, run: "npm run typecheck" },
  { name: "test", keys: ["name", "if", "run", "env"], if: FULL_IF, run: "npm test" },
  { name: "build", keys: ["name", "if", "run"], if: FULL_IF, run: "npm run build" },
  { name: "migrate", keys: ["name", "if", "run", "env"], if: MIGRATE_IF, run: "npm run migrate" },
];

function sourceLines(source: string): SourceLine[] {
  if (source.includes("\t")) {
    throw new Error("tab");
  }
  const lines: SourceLine[] = [];
  for (const rawLine of source.split("\n")) {
    if (rawLine.trim() === "") {
      continue;
    }
    const text = rawLine.trimStart();
    lines.push({
      indent: rawLine.length - text.length,
      text: text.trimEnd(),
    });
  }
  return lines;
}

function splitKey(text: string): { readonly key: string; readonly inline: string } {
  const separator = text.indexOf(":");
  if (separator <= 0) {
    throw new Error(`expected a key in ${text}`);
  }
  const key = text.slice(0, separator);
  const rest = text.slice(separator + 1);
  if (rest === "") {
    return { key, inline: "" };
  }
  if (!rest.startsWith(" ")) {
    throw new Error(`expected a space after ${key}`);
  }
  return { key, inline: rest.slice(1) };
}

function isInlineKey(text: string): boolean {
  if (
    text.startsWith('"') ||
    text.startsWith("'") ||
    text.startsWith("[") ||
    text.startsWith("{")
  ) {
    return false;
  }
  const separator = text.indexOf(":");
  if (separator <= 0) {
    return false;
  }
  const rest = text.slice(separator + 1);
  return rest === "" || rest.startsWith(" ");
}

function parseQuoted(text: string, quote: '"' | "'"): string {
  if (text.length < 2 || !text.endsWith(quote)) {
    throw new Error("unclosed quote");
  }
  const body = text.slice(1, -1);
  if (body.includes(quote)) {
    throw new Error("unescaped quote");
  }
  return body;
}

function parseScalar(text: string): YamlValue {
  if (text.startsWith('"')) {
    return parseQuoted(text, '"');
  }
  if (text.startsWith("'")) {
    return parseQuoted(text, "'");
  }
  if (text.startsWith("[") || text.startsWith("{")) {
    throw new Error("flow collection");
  }
  if (text.startsWith("|") || text.startsWith(">")) {
    throw new Error("block scalar");
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (/^(0|[1-9][0-9]*)$/.test(text)) {
    return Number(text);
  }
  return text;
}

function parseBlock(
  lines: readonly SourceLine[],
  index: number,
): { readonly value: YamlValue; readonly next: number } {
  const line = lines[index];
  if (line === undefined) {
    throw new Error("expected a block");
  }
  if (line.text.startsWith("- ")) {
    return parseSequence(lines, index, line.indent);
  }
  return parseMapping(lines, index, line.indent);
}

function assignKeyText(
  lines: readonly SourceLine[],
  cursor: number,
  keyIndent: number,
  text: string,
  map: { [key: string]: YamlValue },
): number {
  const split = splitKey(text);
  if (Object.hasOwn(map, split.key)) {
    throw new Error(`duplicate key ${split.key}`);
  }
  if (split.inline === "") {
    const child = lines[cursor];
    if (child !== undefined && child.indent > keyIndent) {
      const parsed = parseBlock(lines, cursor);
      map[split.key] = parsed.value;
      return parsed.next;
    }
    map[split.key] = "";
    return cursor;
  }
  map[split.key] = parseScalar(split.inline);
  return cursor;
}

function takeKey(
  lines: readonly SourceLine[],
  index: number,
  indent: number,
  map: { [key: string]: YamlValue },
): number {
  const line = lines[index];
  if (line === undefined) {
    throw new Error("expected a key");
  }
  return assignKeyText(lines, index + 1, indent, line.text, map);
}

function parseMapping(
  lines: readonly SourceLine[],
  index: number,
  indent: number,
): { readonly value: { [key: string]: YamlValue }; readonly next: number } {
  const value: { [key: string]: YamlValue } = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line === undefined || line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error("unexpected indent");
    }
    if (line.text.startsWith("- ")) {
      break;
    }
    cursor = takeKey(lines, cursor, indent, value);
  }
  if (cursor === index) {
    throw new Error("expected a mapping");
  }
  return { value, next: cursor };
}

function parseSequence(
  lines: readonly SourceLine[],
  index: number,
  indent: number,
): { readonly value: YamlValue[]; readonly next: number } {
  const value: YamlValue[] = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (
      line === undefined ||
      line.indent !== indent ||
      !line.text.startsWith("- ")
    ) {
      break;
    }
    const rest = line.text.slice(2);
    const keyIndent = indent + 2;
    cursor += 1;
    if (isInlineKey(rest)) {
      const item: { [key: string]: YamlValue } = {};
      cursor = assignKeyText(lines, cursor, keyIndent, rest, item);
      while (cursor < lines.length) {
        const sibling = lines[cursor];
        if (
          sibling === undefined ||
          sibling.indent !== keyIndent ||
          sibling.text.startsWith("- ")
        ) {
          break;
        }
        cursor = takeKey(lines, cursor, keyIndent, item);
      }
      value.push(item);
    } else {
      value.push(parseScalar(rest));
    }
  }
  if (value.length === 0) {
    throw new Error("expected a sequence");
  }
  return { value, next: cursor };
}

function readWorkflow(source: string): { readonly [key: string]: YamlValue } {
  const lines = sourceLines(source);
  const first = lines[0];
  if (first === undefined) {
    throw new Error("empty workflow");
  }
  const parsed = parseMapping(lines, 0, first.indent);
  if (parsed.next !== lines.length) {
    throw new Error("trailing workflow content");
  }
  return parsed.value;
}

function isYamlRecord(
  value: YamlValue | undefined,
): value is { readonly [key: string]: YamlValue } {
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return true;
}

function asRecord(
  value: YamlValue | undefined,
  label: string,
): { readonly [key: string]: YamlValue } {
  if (!isYamlRecord(value)) {
    throw new Error(`${label} is not a mapping`);
  }
  return value;
}

function asList(
  value: YamlValue | undefined,
  label: string,
): readonly YamlValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not a sequence`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stepByName(
  steps: readonly { readonly [key: string]: YamlValue }[],
  name: string,
): { readonly [key: string]: YamlValue } {
  const found = steps.find((step) => step.name === name);
  if (found === undefined) {
    throw new Error(`missing step ${name}`);
  }
  return found;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout;
}

function initRepo(cwd: string): void {
  runGit(cwd, ["init"]);
  runGit(cwd, ["config", "user.email", "test@example.test"]);
  runGit(cwd, ["config", "user.name", "test"]);
  runGit(cwd, ["config", "commit.gpgsign", "false"]);
}

function withTemp(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "app-ci-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function commitAll(cwd: string, message: string): string {
  runGit(cwd, ["add", "-A"]);
  runGit(cwd, ["commit", "-m", message]);
  return runGit(cwd, ["rev-parse", "HEAD"]).trim();
}

function ciEnv(input: {
  readonly outputPath?: string;
  readonly eventName: string;
  readonly eventBefore: string;
  readonly prBase: string;
  readonly headSha: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    EVENT_NAME: input.eventName,
    EVENT_BEFORE: input.eventBefore,
    PR_BASE: input.prBase,
    HEAD_SHA: input.headSha,
  };
  if (input.outputPath !== undefined) {
    env.GITHUB_OUTPUT = input.outputPath;
  }
  return env;
}

function spawnCi(
  cwd: string,
  env: NodeJS.ProcessEnv,
): { readonly status: number | null; readonly stderr: string; readonly stdout: string } {
  const result = spawnSync("node", [ciScript], {
    cwd,
    encoding: "utf8",
    env,
    shell: false,
  });
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function readOutput(cwd: string): string {
  const outputPath = path.join(cwd, "github-output.txt");
  if (!existsSync(outputPath)) {
    return "";
  }
  return readFileSync(outputPath, "utf8");
}

for (const policyCase of POLICY_CASES) {
  test(policyCase.name, () => {
    const run = (): CiJobPlan =>
      planCiJob({
        changes: policyCase.changes,
        manifest: policyCase.manifest,
      });
    switch (policyCase.expect.kind) {
      case "plan": {
        assert.deepEqual(run(), policyCase.expect.plan);
        return;
      }
      case "throw": {
        assert.throws(run);
        return;
      }
      default: {
        const unexpected: never = policyCase.expect;
        throw new Error(`unexpected expect ${JSON.stringify(unexpected)}`);
      }
    }
  });
}

test("repo package.json runs migrate", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  assert.deepEqual(
    planCiJob({
      changes: { kind: "paths", paths: ["hello.html"] },
      manifest,
    }),
    { depth: "full", runMigrate: true },
  );
});

test("format plan outputs", () => {
  assert.equal(formatPlanOutputs({ depth: "markdown-only" }), MARKDOWN_OUTPUT);
  assert.equal(formatPlanOutputs({ depth: "full", runMigrate: true }), FULL_MIGRATE_OUTPUT);
  assert.equal(formatPlanOutputs({ depth: "full", runMigrate: false }), FULL_SKIP_OUTPUT);
});

test("workflow shape", () => {
  const source = readFileSync(workflowPath, "utf8");
  for (const banned of [
    "pull_request_target",
    "workflow_dispatch",
    "secrets",
    "paths:",
    "password",
    "PASSWORD",
    "environment:",
    "|",
    ">",
  ]) {
    assert.equal(source.includes(banned), false, banned);
  }
  const workflow = readWorkflow(source);
  assert.deepEqual(Object.keys(workflow), ["name", "on", "permissions", "concurrency", "jobs"]);
  assert.equal(workflow.name, "ci");
  const on = asRecord(workflow.on, "on");
  assert.deepEqual(Object.keys(on), ["pull_request", "push"]);
  for (const eventName of ["pull_request", "push"]) {
    const event = asRecord(on[eventName], eventName);
    assert.deepEqual(Object.keys(event), ["branches"]);
    assert.deepEqual(event.branches, ["main"]);
    assert.equal(Object.hasOwn(event, "paths"), false);
  }
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, {
    group: "ci-${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": true,
  });
  const jobs = asRecord(workflow.jobs, "jobs");
  assert.deepEqual(Object.keys(jobs), ["ci"]);
  const job = asRecord(jobs.ci, "ci");
  assert.deepEqual(Object.keys(job), ["name", "runs-on", "timeout-minutes", "env", "services", "steps"]);
  assert.equal(job.name, "ci");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 15);
  assert.equal(Object.hasOwn(job, "environment"), false);
  assert.equal(Object.hasOwn(job, "permissions"), false);
  assert.equal(Object.hasOwn(job, "if"), false);
  assert.deepEqual(job.env, { MODE: "mock" });
  const services = asRecord(job.services, "services");
  assert.deepEqual(Object.keys(services), ["postgres"]);
  const postgres = asRecord(services.postgres, "postgres");
  assert.deepEqual(Object.keys(postgres), ["image", "env", "ports", "options"]);
  assert.equal(postgres.image, "postgres:16");
  assert.deepEqual(postgres.env, { POSTGRES_USER: "postgres", POSTGRES_DB: "app", POSTGRES_HOST_AUTH_METHOD: "trust" });
  assert.deepEqual(postgres.ports, ["5432:5432"]);
  assert.equal(postgres.options, "--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5");
});

test("workflow steps", () => {
  const workflow = readWorkflow(readFileSync(workflowPath, "utf8"));
  const job = asRecord(asRecord(workflow.jobs, "jobs").ci, "ci");
  const steps = asList(job.steps, "steps").map((step) => asRecord(step, "step"));
  assert.deepEqual(
    steps.map((step) => step.name),
    STEP_CLAIMS.map((claim) => claim.name),
  );
  for (let index = 0; index < STEP_CLAIMS.length; index += 1) {
    const claim = STEP_CLAIMS[index];
    const step = steps[index];
    if (claim === undefined || step === undefined) {
      throw new Error("missing step claim");
    }
    assert.equal(step.name, claim.name);
    assert.deepEqual(Object.keys(step), claim.keys);
    if (claim.if !== undefined) {
      assert.equal(step.if, claim.if);
    }
    if (claim.run !== undefined) {
      assert.equal(step.run, claim.run);
    }
    if (claim.uses !== undefined) {
      assert.equal(step.uses, claim.uses);
    }
  }
  const secretAt = steps.findIndex((step) => step.name === "secret scan");
  const buildAt = steps.findIndex((step) => step.name === "build");
  assert.equal(secretAt, 3);
  assert.equal(buildAt, 9);
  for (const step of steps.slice(0, secretAt)) {
    assert.equal(Object.hasOwn(step, "if"), false);
  }
  for (const step of steps.slice(secretAt, buildAt + 1)) {
    assert.equal(step.if, FULL_IF);
  }
  assert.equal(steps[buildAt + 1]?.name, "migrate");
  assert.equal(steps[buildAt + 1]?.if, MIGRATE_IF);
  assert.deepEqual(stepByName(steps, "checkout").with, { "fetch-depth": "0", "persist-credentials": false });
  assert.deepEqual(stepByName(steps, "setup node").with, { "node-version-file": ".nvmrc" });
  assert.deepEqual(stepByName(steps, "npm cache").with, { "node-version-file": ".nvmrc", cache: "npm" });
  const cacheNames = steps
    .filter((step) => {
      return isYamlRecord(step.with) && step.with.cache === "npm";
    })
    .map((step) => step.name);
  assert.deepEqual(cacheNames, ["npm cache"]);
  const plan = stepByName(steps, "plan");
  assert.equal(plan.id, "plan");
  assert.deepEqual(plan.env, { EVENT_NAME: "${{ github.event_name }}", EVENT_BEFORE: "${{ github.event.before }}", PR_BASE: "${{ github.event.pull_request.base.sha }}", HEAD_SHA: "${{ github.sha }}" });
  assert.deepEqual(stepByName(steps, "migrate").env, { DATABASE_URL: "postgres://postgres@localhost:5432/app" });
  for (const name of ["test", "migrate"]) {
    const env = stepByName(steps, name).env;
    assert.ok(isYamlRecord(env), name);
    const url = new URL(String(env.DATABASE_URL));
    assert.equal(url.pathname, "/app", `${name} must use the database the postgres service creates`);
  }
  assert.deepEqual(stepByName(steps, "test").env, stepByName(steps, "migrate").env);
});

test("reader rejects a tab", () => {
  assert.throws(() => readWorkflow("name: ci\n\ton: push\n"));
});

test("reader rejects a flow sequence", () => {
  assert.throws(() => readWorkflow("on:\n  push:\n    branches: [main]\n"));
});

test("reader rejects a duplicate key", () => {
  assert.throws(() => readWorkflow("name: ci\nname: other\n"));
});

test("reader rejects a block scalar", () => {
  assert.throws(() => readWorkflow("run: |\n  npm test\n"));
  assert.throws(() => readWorkflow("run: >\n  npm test\n"));
});

test("test script lists every test file", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  if (!isRecord(manifest) || !isRecord(manifest.scripts)) {
    throw new Error("package.json scripts missing");
  }
  assert.equal(manifest.scripts.test, TEST_SCRIPT);
});

test("secret scan pin", () => {
  assert.equal(
    readFileSync(path.join(repoRoot, ".github/ci/secret-scan.sh"), "utf8"),
    SECRET_SCAN,
  );
});

function writePackage(dir: string, manifest: unknown): void {
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(manifest)}\n`);
}

function commitFile(dir: string, file: string, body: string, message: string): string {
  writeFileSync(path.join(dir, file), body);
  return commitAll(dir, message);
}

function expectPlan(
  dir: string,
  eventName: string,
  eventBefore: string,
  prBase: string,
  headSha: string,
  expected: string,
): void {
  const outputPath = path.join(dir, "github-output.txt");
  const run = spawnCi(dir, ciEnv({
    outputPath,
    eventName,
    eventBefore,
    prBase,
    headSha,
  }));
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(readOutput(dir), expected);
}

test("markdown commit writes markdown-only", () => {
  withTemp((dir) => {
    initRepo(dir);
    writePackage(dir, { private: true, scripts: { migrate: "tsx db/migrate.ts" } });
    const base = commitFile(dir, "README.md", "one\n", "base");
    const head = commitFile(dir, "README.md", "two\n", "head");
    expectPlan(dir, "pull_request", ZERO_SHA, base, head, MARKDOWN_OUTPUT);
  });
});

test("forty zeros writes full", () => {
  withTemp((dir) => {
    writePackage(dir, {});
    expectPlan(dir, "push", ZERO_SHA, "", "a".repeat(40), FULL_SKIP_OUTPUT);
  });
});

test("migrate script writes run_migrate true", () => {
  withTemp((dir) => {
    initRepo(dir);
    writePackage(dir, { private: true, scripts: { migrate: "tsx db/migrate.ts" } });
    const base = commitFile(dir, "hello.html", "one\n", "base");
    const head = commitFile(dir, "hello.html", "two\n", "head");
    writeFileSync(path.join(dir, "github-output.txt"), "prior=1\n");
    expectPlan(dir, "push", base, "", head, `prior=1\n${FULL_MIGRATE_OUTPUT}`);
  });
});

test("missing output exits 1", () => {
  withTemp((dir) => {
    writePackage(dir, {});
    const run = spawnCi(dir, ciEnv({
      eventName: "push",
      eventBefore: ZERO_SHA,
      prBase: "",
      headSha: "a".repeat(40),
    }));
    assert.equal(run.status, 1);
    assert.deepEqual(readdirSync(dir), ["package.json"]);
  });
});

test("bad package.json exits 1", () => {
  withTemp((dir) => {
    writeFileSync(path.join(dir, "package.json"), "not-json\n");
    const outputPath = path.join(dir, "github-output.txt");
    writeFileSync(outputPath, "");
    const run = spawnCi(dir, ciEnv({
      outputPath,
      eventName: "push",
      eventBefore: ZERO_SHA,
      prBase: "",
      headSha: "a".repeat(40),
    }));
    assert.equal(run.status, 1);
    assert.equal(readFileSync(outputPath, "utf8"), "");
  });
});

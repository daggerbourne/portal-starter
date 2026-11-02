import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Pair, type YAMLMap } from "yaml";

const SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = "0".repeat(40);
const COMMANDS = ["plan", "ci-permissions"] as const;
const PULL_REQUEST_READERS = new Set(["db-copy.yml", "db-sweep.yml", "verdicts.yml"]);

type Command = (typeof COMMANDS)[number];

export type ChangeList =
  | { readonly kind: "paths"; readonly paths: readonly string[] }
  | { readonly kind: "unknown" };

export type GuardDepth = "markdown-only" | "full";

export type WorkflowGrant = {
  readonly scope: string;
  readonly access: string;
};

export type WorkflowFacts = {
  readonly events: readonly string[];
  readonly grants: readonly WorkflowGrant[];
  readonly environments: readonly string[];
};

export type PermissionJudgment =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

export function guardDepth(changes: ChangeList): GuardDepth {
  switch (changes.kind) {
    case "paths":
      if (changes.paths.length > 0 && changes.paths.every((file) => file.endsWith(".md"))) {
        return "markdown-only";
      }
      return "full";
    case "unknown":
      return "full";
    default: {
      const unexpected: never = changes;
      throw new Error(`unexpected changes ${JSON.stringify(unexpected)}`);
    }
  }
}

export function changesFromEnv(
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): ChangeList {
  switch (env.EVENT_NAME) {
    case "pull_request":
      return diffRange(env.PR_BASE, env.HEAD_SHA, cwd);
    case "push":
      if (env.EVENT_BEFORE === ZERO_SHA) {
        return { kind: "unknown" };
      }
      return diffRange(env.EVENT_BEFORE, env.HEAD_SHA, cwd);
    default:
      return { kind: "unknown" };
  }
}

export function workflowFacts(source: string): WorkflowFacts {
  const doc = parseDocument(source, { logLevel: "silent", merge: false, uniqueKeys: false });
  if (doc.errors.length > 0) throw new Error("parse");
  if (!isMap(doc.contents)) throw new Error("root");
  rejectRisky(doc.contents);
  const data = asRecord(doc.toJS());
  const jobs = data.jobs;
  return {
    events: readEvents(data.on),
    grants: [...readGrants(data.permissions), ...readJobGrants(jobs)],
    environments: [...readEnvironment(data.environment), ...readJobEnvironments(jobs)],
  };
}

export function judgeWorkflowPermissions(
  fileName: string,
  source: string,
): PermissionJudgment {
  let facts: WorkflowFacts;
  try {
    facts = workflowFacts(source);
  } catch {
    return { ok: false, reasons: ["unreadable workflow"] };
  }
  const reasons: string[] = [];
  if (facts.grants.length === 0) reasons.push("permissions are missing");
  for (const grant of facts.grants) {
    if (!grantAllowed(fileName, grant)) reasons.push(grantReason(grant));
  }
  if (facts.events.includes("pull_request") && facts.environments.some(namesNeon)) {
    reasons.push("pull_request names environment neon");
  }
  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons };
}

function namesNeon(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.toLowerCase() === "neon" || trimmed.includes("${{");
}

function grantAllowed(fileName: string, grant: WorkflowGrant): boolean {
  if (grant.scope === "contents" && grant.access === "read") return true;
  return grant.scope === "pull-requests" && grant.access === "read" && PULL_REQUEST_READERS.has(fileName);
}

function grantReason(grant: WorkflowGrant): string {
  if (grant.access === "") return `grant ${grant.scope}`;
  return `grant ${grant.scope} ${grant.access}`;
}

function rejectRisky(root: YAMLMap): void {
  let jobs: unknown = null;
  for (const item of root.items) {
    if (isAlias(item.key) || isMerge(item) || isAlias(item.value)) throw new Error("alias");
    const key = scalarKey(item);
    if (key === "on" || key === "permissions" || key === "environment") rejectAlias(item.value);
    if (key === "jobs") jobs = item.value;
  }
  rejectJobs(jobs);
}

function rejectJobs(node: unknown): void {
  if (node == null) return;
  if (isAlias(node)) throw new Error("alias");
  if (!isMap(node)) return;
  for (const item of node.items) {
    if (isAlias(item.key) || isMerge(item) || isAlias(item.value)) throw new Error("alias");
    if (!isMap(item.value)) continue;
    for (const field of item.value.items) {
      if (isAlias(field.key) || isMerge(field)) throw new Error("alias");
      const key = scalarKey(field);
      if (key === "permissions" || key === "environment") rejectAlias(field.value);
    }
  }
}

function rejectAlias(node: unknown): void {
  if (node == null || isScalar(node)) return;
  if (isAlias(node)) throw new Error("alias");
  if (isMap(node)) {
    for (const item of node.items) {
      if (isAlias(item.key) || isMerge(item)) throw new Error("alias");
      rejectAlias(item.value);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) rejectAlias(item);
  }
}

function isMerge(pair: Pair): boolean {
  return isScalar(pair.key) && (pair.key.value === "<<" || pair.key.tag === "tag:yaml.org,2002:merge");
}

function scalarKey(pair: Pair): string | undefined {
  if (!isScalar(pair.key) || typeof pair.key.value !== "string") return undefined;
  return pair.key.value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("root");
  return value as Record<string, unknown>;
}

function readEvents(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item !== "string" || item === "") throw new Error("on");
      return item;
    });
  }
  if (typeof value !== "object") throw new Error("on");
  return Object.keys(value);
}

function readGrants(value: unknown): WorkflowGrant[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value === "" ? [] : [{ scope: value, access: "" }];
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("permissions");
  const grants: WorkflowGrant[] = [];
  for (const [scope, access] of Object.entries(value)) {
    if (scope === "<<" || typeof access !== "string") throw new Error("permissions");
    grants.push({ scope, access });
  }
  return grants;
}

function readEnvironment(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    const name = value.trim();
    return name === "" ? [] : [name];
  }
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("environment");
  const name = (value as Record<string, unknown>).name;
  if (name === undefined || name === null) return [];
  if (typeof name !== "string") throw new Error("environment");
  const trimmed = name.trim();
  return trimmed === "" ? [] : [trimmed];
}

function eachJob(jobs: unknown): readonly Record<string, unknown>[] {
  if (jobs === undefined || jobs === null) return [];
  if (typeof jobs !== "object" || Array.isArray(jobs)) throw new Error("jobs");
  return Object.values(jobs).map((job) => {
    if (job === null || typeof job !== "object" || Array.isArray(job)) throw new Error("job");
    return job as Record<string, unknown>;
  });
}

function readJobGrants(jobs: unknown): WorkflowGrant[] {
  return eachJob(jobs).flatMap((job) => readGrants(job.permissions));
}

function readJobEnvironments(jobs: unknown): string[] {
  return eachJob(jobs).flatMap((job) => readEnvironment(job.environment));
}

function isSha(value: string | undefined): value is string {
  return value !== undefined && SHA.test(value);
}

function diffRange(from: string | undefined, to: string | undefined, cwd: string): ChangeList {
  if (!isSha(from) || !isSha(to)) return { kind: "unknown" };
  const result = spawnSync("git", ["diff", "-z", "--name-only", "--no-renames", from, to], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return { kind: "unknown" };
  const parts = result.stdout.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return { kind: "paths", paths: parts };
}

function runPlan(): number {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) return 1;
  appendFileSync(outputPath, `depth=${guardDepth(changesFromEnv(process.env))}\n`);
  return 0;
}

function runPermissions(): number {
  const dir = path.join(process.cwd(), ".github/workflows");
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  const lines: string[] = [];
  for (const name of names) {
    const judgment = judgeWorkflowPermissions(name, readFileSync(path.join(dir, name), "utf8"));
    if (!judgment.ok) {
      for (const reason of judgment.reasons) lines.push(`${name}: ${reason}`);
    }
  }
  if (lines.length === 0) return 0;
  process.stderr.write(`${lines.join("\n")}\n`);
  return 1;
}

function isCommand(value: string): value is Command {
  for (const command of COMMANDS) {
    if (command === value) return true;
  }
  return false;
}

function runCommand(command: Command): number {
  switch (command) {
    case "plan":
      return runPlan();
    case "ci-permissions":
      return runPermissions();
    default: {
      const unexpected: never = command;
      throw new Error(unexpected);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    const command = process.argv[2] ?? "";
    if (!isCommand(command)) {
      process.stderr.write("unknown command\n");
      process.exit(1);
    }
    process.exit(runCommand(command));
  } catch (error) {
    const message = error instanceof Error ? error.message : "guard failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

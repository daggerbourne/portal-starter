import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = "0".repeat(40);

export type ChangeList =
  | { readonly kind: "paths"; readonly paths: readonly string[] }
  | { readonly kind: "unknown" };

export type CiJobPlan =
  | { readonly depth: "markdown-only" }
  | { readonly depth: "full"; readonly runMigrate: boolean };

export function planCiJob(input: {
  readonly changes: ChangeList;
  readonly manifest: unknown;
}): CiJobPlan {
  switch (input.changes.kind) {
    case "paths":
      if (markdownOnly(input.changes.paths)) {
        return { depth: "markdown-only" };
      }
      return { depth: "full", runMigrate: readRunMigrate(input.manifest) };
    case "unknown":
      return { depth: "full", runMigrate: readRunMigrate(input.manifest) };
    default: {
      const unexpected: never = input.changes;
      throw new Error(`unexpected changes ${JSON.stringify(unexpected)}`);
    }
  }
}

export function formatPlanOutputs(plan: CiJobPlan): string {
  switch (plan.depth) {
    case "markdown-only":
      return "depth=markdown-only\nrun_migrate=false\n";
    case "full":
      if (plan.runMigrate) {
        return "depth=full\nrun_migrate=true\n";
      }
      return "depth=full\nrun_migrate=false\n";
    default: {
      const unexpected: never = plan;
      throw new Error(`unexpected plan ${JSON.stringify(unexpected)}`);
    }
  }
}

function markdownOnly(paths: readonly string[]): boolean {
  return (
    paths.length > 0 && paths.every((filePath) => filePath.endsWith(".md"))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readRunMigrate(manifest: unknown): boolean {
  if (!isPlainObject(manifest)) {
    throw new Error("manifest is not an object");
  }
  if (!Object.hasOwn(manifest, "scripts")) {
    return false;
  }
  if (!isPlainObject(manifest.scripts)) {
    throw new Error("scripts is not an object");
  }
  if (!Object.hasOwn(manifest.scripts, "migrate")) {
    return false;
  }
  const migrate = manifest.scripts.migrate;
  if (typeof migrate !== "string") {
    throw new Error("migrate is not a string");
  }
  return migrate.length > 0;
}

function isSha(value: string | undefined): value is string {
  return value !== undefined && SHA.test(value);
}

function diffPaths(from: string, to: string): ChangeList {
  const result = spawnSync(
    "git",
    ["diff", "-z", "--name-only", "--no-renames", from, to],
    { encoding: "utf8", shell: false },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return { kind: "unknown" };
  }
  const parts = result.stdout.split("\0");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return { kind: "paths", paths: parts };
}

function diffRange(
  from: string | undefined,
  to: string | undefined,
): ChangeList {
  if (!isSha(from) || !isSha(to)) {
    return { kind: "unknown" };
  }
  return diffPaths(from, to);
}

function changesFromEnv(): ChangeList {
  switch (process.env.EVENT_NAME) {
    case "pull_request":
      return diffRange(process.env.PR_BASE, process.env.HEAD_SHA);
    case "push":
      if (process.env.EVENT_BEFORE === ZERO_SHA) {
        return { kind: "unknown" };
      }
      return diffRange(process.env.EVENT_BEFORE, process.env.HEAD_SHA);
    default:
      return { kind: "unknown" };
  }
}

function loadManifest(): unknown {
  try {
    return JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
  } catch {
    process.exit(1);
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) {
    process.exit(1);
  }
  const plan = planCiJob({
    changes: changesFromEnv(),
    manifest: loadManifest(),
  });
  appendFileSync(outputPath, formatPlanOutputs(plan));
}

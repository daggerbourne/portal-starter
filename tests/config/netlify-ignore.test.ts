import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readIgnoreCommand(toml: string): string {
  const matches = [...toml.matchAll(/^ignore = '([^']*)'$/gm)];
  if (matches.length !== 1) {
    throw new Error(`expected one ignore command, found ${matches.length}`);
  }
  const command = matches[0]?.[1];
  if (command === undefined) {
    throw new Error("expected one ignore command");
  }
  return command;
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
  });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout;
}

function writeRepoFile(cwd: string, file: string, body: string): void {
  const fullPath = path.join(cwd, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body);
}

function initRepo(dir: string, branch: "main" | "pr"): void {
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "test@example.test"]);
  runGit(dir, ["config", "user.name", "test"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  writeRepoFile(dir, "README.md", "one\n");
  writeRepoFile(dir, "hello.html", "h\n");
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "base"]);
  const base = runGit(dir, ["rev-parse", "HEAD"]).trim();
  runGit(dir, ["branch", "-M", branch]);
  if (branch === "main") {
    runGit(dir, ["update-ref", "refs/remotes/origin/main", base]);
    runGit(dir, ["checkout", "-b", "pr"]);
  }
}

function commitWrite(dir: string, file: string, body: string): string {
  writeRepoFile(dir, file, body);
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-m", "head"]);
  return runGit(dir, ["rev-parse", "HEAD"]).trim();
}

function commitDelete(dir: string, file: string): string {
  runGit(dir, ["rm", file]);
  runGit(dir, ["commit", "-m", "head"]);
  return runGit(dir, ["rev-parse", "HEAD"]).trim();
}

function runIgnore(dir: string, command: string, cached: string, commit: string): number {
  const result = spawnSync("bash", ["-c", command], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...gitEnv(),
      CACHED_COMMIT_REF: cached,
      COMMIT_REF: commit,
    },
  });
  if (result.status === null) {
    throw new Error(result.stderr ?? "ignore command did not exit");
  }
  return result.status;
}

function withRepo(branch: "main" | "pr", run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "app-netlify-ignore-"));
  try {
    initRepo(dir, branch);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ignoreCommand = readIgnoreCommand(
  readFileSync(path.join(repoRoot, "netlify.toml"), "utf8"),
);

test("no-cache preview skips a markdown-only pull request", () => {
  withRepo("main", (dir) => {
    const head = commitWrite(dir, "README.md", "two\n");
    assert.equal(runIgnore(dir, ignoreCommand, head, head), 0);
  });
});

test("no-cache preview builds a code change", () => {
  withRepo("main", (dir) => {
    const head = commitWrite(dir, "hello.html", "changed\n");
    assert.notEqual(runIgnore(dir, ignoreCommand, head, head), 0);
  });
});

test("no-cache preview builds when main is absent", () => {
  withRepo("pr", (dir) => {
    const head = commitWrite(dir, "README.md", "two\n");
    assert.notEqual(runIgnore(dir, ignoreCommand, head, head), 0);
  });
});

test("markdown add and delete skip against the last built commit", () => {
  withRepo("main", (dir) => {
    const built = commitWrite(dir, "hello.html", "built\n");
    const added = commitWrite(dir, "tests/config/probe.md", "probe\n");
    assert.equal(runIgnore(dir, ignoreCommand, built, added), 0);
    const removed = commitDelete(dir, "tests/config/probe.md");
    assert.equal(runIgnore(dir, ignoreCommand, built, removed), 0);
  });
});

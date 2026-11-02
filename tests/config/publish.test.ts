import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

type IgnoreExpectation = "skip" | "build";

type IgnoreChange =
  | { readonly kind: "write"; readonly path: string; readonly body: string }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "rename"; readonly from: string; readonly to: string };

type IgnoreSetup =
  | {
      readonly kind: "commits";
      readonly changes: readonly IgnoreChange[];
      readonly refs: "base-to-head" | "head-to-head";
    }
  | { readonly kind: "missing-cached" }
  | { readonly kind: "unknown-cached" };

type IgnoreCase = {
  readonly name: string;
  readonly setup: IgnoreSetup;
  readonly expectation: IgnoreExpectation;
};

const IGNORE_BASE: readonly IgnoreChange[] = [
  { kind: "write", path: "README.md", body: "one\n" },
  { kind: "write", path: "hello.html", body: "h\n" },
];

const IGNORE_CASES: readonly IgnoreCase[] = [
  {
    name: "root markdown",
    setup: {
      kind: "commits",
      changes: [{ kind: "write", path: "README.md", body: "two\n" }],
      refs: "base-to-head",
    },
    expectation: "skip",
  },
  {
    name: "nested markdown",
    setup: {
      kind: "commits",
      changes: [{ kind: "write", path: "specs/note.md", body: "spec\n" }],
      refs: "base-to-head",
    },
    expectation: "skip",
  },
  {
    name: "html change",
    setup: {
      kind: "commits",
      changes: [{ kind: "write", path: "hello.html", body: "changed\n" }],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "mixed",
    setup: {
      kind: "commits",
      changes: [
        { kind: "write", path: "README.md", body: "two\n" },
        { kind: "write", path: "hello.html", body: "changed\n" },
      ],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "delete code",
    setup: {
      kind: "commits",
      changes: [
        { kind: "delete", path: "hello.html" },
        { kind: "write", path: "README.md", body: "two\n" },
      ],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "rename to markdown",
    setup: {
      kind: "commits",
      changes: [{ kind: "rename", from: "hello.html", to: "hello.md" }],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "markdown suffix decoy",
    setup: {
      kind: "commits",
      changes: [{ kind: "write", path: "notes.md.bak", body: "x\n" }],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "css",
    setup: {
      kind: "commits",
      changes: [{ kind: "write", path: "design/tokens.css", body: "tok\n" }],
      refs: "base-to-head",
    },
    expectation: "build",
  },
  {
    name: "empty commit",
    setup: { kind: "commits", changes: [], refs: "base-to-head" },
    expectation: "build",
  },
  {
    name: "identical refs",
    setup: { kind: "commits", changes: [], refs: "head-to-head" },
    expectation: "build",
  },
  {
    name: "missing cached ref",
    setup: { kind: "missing-cached" },
    expectation: "build",
  },
  {
    name: "unknown cached ref",
    setup: { kind: "unknown-cached" },
    expectation: "build",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function applyChange(cwd: string, change: IgnoreChange): void {
  switch (change.kind) {
    case "write": {
      const fullPath = path.join(cwd, change.path);
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, change.body);
      return;
    }
    case "delete": {
      runGit(cwd, ["rm", change.path]);
      return;
    }
    case "rename": {
      runGit(cwd, ["mv", change.from, change.to]);
      return;
    }
    default: {
      const unexpected: never = change;
      throw new Error(`unexpected change ${JSON.stringify(unexpected)}`);
    }
  }
}

function runIgnoreCase(command: string, testCase: IgnoreCase): void {
  const dir = mkdtempSync(path.join(tmpdir(), "app-ignore-"));
  try {
    runGit(dir, ["init"]);
    runGit(dir, ["config", "user.email", "test@example.test"]);
    runGit(dir, ["config", "user.name", "test"]);
    runGit(dir, ["config", "commit.gpgsign", "false"]);
    for (const change of IGNORE_BASE) {
      applyChange(dir, change);
    }
    runGit(dir, ["add", "-A"]);
    runGit(dir, ["commit", "-m", "base"]);
    const base = runGit(dir, ["rev-parse", "HEAD"]).trim();
    let cached = base;
    let commit = base;
    switch (testCase.setup.kind) {
      case "commits": {
        switch (testCase.setup.refs) {
          case "base-to-head": {
            if (testCase.setup.changes.length === 0) {
              runGit(dir, ["commit", "--allow-empty", "-m", "empty"]);
            } else {
              for (const change of testCase.setup.changes) {
                applyChange(dir, change);
              }
              runGit(dir, ["add", "-A"]);
              runGit(dir, ["commit", "-m", "head"]);
            }
            cached = base;
            commit = runGit(dir, ["rev-parse", "HEAD"]).trim();
            break;
          }
          case "head-to-head": {
            cached = base;
            commit = base;
            break;
          }
          default: {
            const unexpectedRefs: never = testCase.setup.refs;
            throw new Error(`unexpected refs ${String(unexpectedRefs)}`);
          }
        }
        break;
      }
      case "missing-cached": {
        cached = "";
        commit = base;
        break;
      }
      case "unknown-cached": {
        cached = "0123456789abcdef0123456789abcdef01234567";
        commit = base;
        break;
      }
      default: {
        const unexpectedSetup: never = testCase.setup;
        throw new Error(`unexpected setup ${JSON.stringify(unexpectedSetup)}`);
      }
    }
    const result = spawnSync("bash", ["-c", command], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        CACHED_COMMIT_REF: cached,
        COMMIT_REF: commit,
      },
    });
    if (result.status === null) {
      throw new Error(result.stderr ?? "ignore command did not exit");
    }
    if (testCase.expectation === "skip") {
      assert.equal(result.status, 0, result.stderr ?? "");
      return;
    }
    if (testCase.expectation === "build") {
      assert.notEqual(result.status, 0);
      return;
    }
    const unexpectedExpectation: never = testCase.expectation;
    throw new Error(`unexpected expectation ${String(unexpectedExpectation)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("tsconfig is strict and does not emit", () => {
  const value: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8"),
  );
  assert.equal(isRecord(value), true);
  if (!isRecord(value) || !isRecord(value.compilerOptions)) {
    throw new Error("tsconfig compilerOptions missing");
  }
  assert.equal(value.compilerOptions.strict, true);
  assert.equal(value.compilerOptions.noEmit, true);
});

test("node 22 pins agree", () => {
  assert.deepEqual(
    readFileSync(path.join(repoRoot, ".nvmrc")),
    Buffer.from("22\n"),
  );
  const pkg: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  assert.equal(isRecord(pkg) && isRecord(pkg.engines) && pkg.engines.node, "22.x");
  const toml = readFileSync(path.join(repoRoot, "netlify.toml"), "utf8");
  assert.equal(toml.includes('NODE_VERSION = "22"'), true);
  assert.equal(toml.includes('publish = "dist"'), true);
  assert.equal(toml.includes('command = "npm run build"'), true);
  assert.equal(toml.includes('directory = "server/functions"'), true);
});

test("cloud agent install is npm ci", () => {
  const environment: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, ".cursor/environment.json"), "utf8"),
  );
  assert.deepEqual(environment, { install: "npm ci" });
  assert.equal(isRecord(environment) && Object.keys(environment).length, 1);
});

test("server/functions/.gitkeep is a file", () => {
  assert.equal(
    statSync(path.join(repoRoot, "server/functions/.gitkeep")).isFile(),
    true,
  );
});

const ignoreCommand = readIgnoreCommand(
  readFileSync(path.join(repoRoot, "netlify.toml"), "utf8"),
);

for (const testCase of IGNORE_CASES) {
  test(`ignore ${testCase.name}`, () => {
    runIgnoreCase(ignoreCommand, testCase);
  });
}

test("publish hello page", () => {
  const runBuild = (): void => {
    const env = { ...process.env };
    delete env.CONTEXT;
    const result = spawnSync("npm", ["run", "build"], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  };
  runBuild();
  const htmlPath = path.join(repoRoot, "dist/portal-starter/index.html");
  const cssPath = path.join(repoRoot, "dist/portal-starter/tokens.css");
  const firstHtml = readFileSync(htmlPath);
  const firstCss = readFileSync(cssPath);
  const html = firstHtml.toString("utf8");
  assert.equal(html.includes("<title>Portal Starter</title>"), true);
  assert.equal(html.includes("<h1>Hello</h1>"), true);
  assert.deepEqual(html.match(/href="tokens\.css"/g), ['href="tokens.css"']);
  assert.equal(html.includes('<meta name="robots" content="noindex, nofollow">'), true);
  assert.equal(
    html.includes('<p class="dev-banner" role="status">DEV/preview environment. Test data only.</p>'),
    true,
  );
  assert.equal(html.includes("var(--dev-banner-bg)"), true);
  assert.equal(html.includes("<button"), false);
  assert.equal(html.includes("<script"), false);
  assert.deepEqual(
    firstCss,
    readFileSync(path.join(repoRoot, "design/tokens.css")),
  );
  assert.equal(existsSync(path.join(repoRoot, "dist.build")), false);
  runBuild();
  assert.deepEqual(readFileSync(htmlPath), firstHtml);
  assert.deepEqual(readFileSync(cssPath), firstCss);
  assert.equal(existsSync(path.join(repoRoot, "dist.build")), false);
});

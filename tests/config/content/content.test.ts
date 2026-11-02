import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planCiJob } from "../../../.github/ci/ci.js";
import {
  judgeCopy,
  parseBannedWords,
  parseDiff,
  pathsToRead,
  planContentScan,
  type ContentFinding,
  type PathChange,
  type TextFile,
} from "../../../.github/content/run.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptPath = path.join(repoRoot, ".github/content/run.ts");
const ZERO_SHA = "0".repeat(40);

type Hit = { readonly line: number; readonly excerpt: string };
type Sample = {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly hits: readonly Hit[];
};

const WORDS = ["quote", "sign up"] as const;

function listed(judge: (file: TextFile, words: readonly string[]) => readonly ContentFinding[], samples: readonly Sample[]): void {
  for (const sample of samples) {
    test(sample.name, () => {
      assert.deepEqual(
        judge({ path: sample.path, text: sample.text }, WORDS),
        sample.hits.map((hit) => ({ path: sample.path, line: hit.line, excerpt: hit.excerpt })),
      );
    });
  }
}

const COPY_SAMPLES: readonly Sample[] = [
  { name: "ui string quote", path: "ui/home.ts", text: 'export const label = "Your quote is ready"', hits: [{ line: 1, excerpt: "quote" }] },
  { name: "server string quote", path: "server/home.ts", text: 'export const label = "Your quote is ready"', hits: [{ line: 1, excerpt: "quote" }] },
  { name: "ui template quote", path: "ui/home.ts", text: "export const label = `Your quote is ready`", hits: [{ line: 1, excerpt: "quote" }] },
  { name: "ui string Quote", path: "ui/home.ts", text: 'export const label = "Quote"', hits: [{ line: 1, excerpt: "Quote" }] },
  { name: "hello html quote", path: "hello.html", text: "Your quote is ready", hits: [{ line: 1, excerpt: "quote" }] },
  { name: "tests html quote", path: "tests/page.html", text: "Your quote is ready", hits: [{ line: 1, excerpt: "quote" }] },
  { name: "ui html is raw text", path: "ui/page.html", text: 'export const label = "estimate" // quote', hits: [{ line: 1, excerpt: "quote" }] },
  {
    name: "ui quote on line 2",
    path: "ui/home.ts",
    text: 'export const label = "estimate"\nexport const next = "Your quote is ready"\n',
    hits: [{ line: 2, excerpt: "quote" }],
  },
  { name: "ui quote inside a template hole", path: "ui/home.tsx", text: 'const label = `estimate ${"Your quote is ready"}`\n', hits: [{ line: 1, excerpt: "quote" }] },
  {
    name: "regex does not hide a later string",
    path: "ui/home.ts",
    text: 'const pattern = /quote/;\nconst label = "Your quote is ready";\n',
    hits: [{ line: 2, excerpt: "quote" }],
  },
  {
    name: "postfix keeps the following string",
    path: "ui/home.ts",
    text: 'const n = a++ / 2;\nconst label = "Your quote is ready";\n',
    hits: [{ line: 2, excerpt: "quote" }],
  },
  { name: "ui estimate", path: "ui/home.ts", text: 'export const label = "Your estimate is ready"', hits: [] },
  { name: "ui quoted is not quote", path: "ui/home.ts", text: 'const a = "quoted"\nconst b = "unquote"\n', hits: [] },
  { name: "a phrase matches with a space or hyphen", path: "ui/home.ts", text: 'const a = "Sign up today"\nconst b = "sign-up"\n', hits: [{ line: 1, excerpt: "Sign up" }, { line: 2, excerpt: "sign-up" }] },
  { name: "adapters are not user copy", path: "adapters/vendor/quote.ts", text: 'export const label = "Your quote is ready"', hits: [] },
  { name: "ui comment only", path: "ui/home.ts", text: 'export const label = "estimate" // quote', hits: [] },
  { name: "ui identifier quoteLabel", path: "ui/home.ts", text: "const quoteLabel = 1\n", hits: [] },
  { name: "core string quote", path: "core/note.ts", text: 'export const label = "Your quote is ready"', hits: [] },
  { name: "design html quote", path: "design/board.html", text: "Your quote is ready", hits: [] },
  { name: "raw newline ends a ui string", path: "ui/home.ts", text: 'const label = "Your\nquote is ready"\n', hits: [] },
];

listed(judgeCopy, COPY_SAMPLES);

test("an empty word list finds nothing", () => {
  assert.deepEqual(judgeCopy({ path: "ui/home.ts", text: 'export const label = "Your quote is ready"' }, []), []);
});

test("the word list skips comments and blanks and refuses odd entries", () => {
  assert.deepEqual(parseBannedWords("# note\n\nQuote\n  sign up  \n"), ["quote", "sign up"]);
  assert.throws(() => parseBannedWords("quo.te\n"));
  assert.throws(() => parseBannedWords("(quote|x)\n"));
});

test("the committed word list parses", () => {
  const text = readFileSync(path.join(repoRoot, "program/banned-words.txt"), "utf8");
  assert.doesNotThrow(() => parseBannedWords(text));
});

test("planContentScan agrees with planCiJob", () => {
  const lists: readonly (readonly string[])[] = [
    ["specs/a.md", "README.md"],
    [],
    ["note.MD"],
    ["notes.md.bak"],
    ["dir.md/file.ts"],
    ["README.md", "ui/home.ts"],
    ["note.MD", "a.md"],
  ];
  for (const paths of lists) {
    const content = planContentScan(paths);
    const ci = planCiJob({ changes: { kind: "paths", paths }, manifest: { scripts: {} } });
    switch (ci.depth) {
      case "markdown-only":
        assert.deepEqual(content, { scan: false, output: "scan=false\n" });
        break;
      case "full":
        assert.equal(ci.runMigrate, false);
        assert.deepEqual(content, { scan: true, output: "scan=true\n" });
        break;
      default: {
        const unexpected: never = ci;
        throw new Error(`unexpected plan ${JSON.stringify(unexpected)}`);
      }
    }
  }
});

test("pathsToRead drops deletions and keeps order", () => {
  const changes: readonly PathChange[] = [
    { kind: "deleted", path: "a.md" },
    { kind: "present", path: "ui/home.ts" },
    { kind: "deleted", path: "b.ts" },
    { kind: "present", path: "server/home.ts" },
  ];
  assert.deepEqual(pathsToRead(changes), ["ui/home.ts", "server/home.ts"]);
});

test("parseDiff reads name-status records", () => {
  assert.deepEqual(parseDiff({ status: 1, stdout: "A\0file.ts\0" }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: null, stdout: "" }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: 0, stdout: undefined }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: 0, stdout: "" }), { kind: "entries", entries: [] });
  assert.deepEqual(parseDiff({ status: 0, stdout: "A\0ui/a.ts\0M\0server/b.ts\0T\0ui/c.tsx\0D\0old.md\0" }), {
    kind: "entries",
    entries: [
      { kind: "present", path: "ui/a.ts" },
      { kind: "present", path: "server/b.ts" },
      { kind: "present", path: "ui/c.tsx" },
      { kind: "deleted", path: "old.md" },
    ],
  });
  assert.deepEqual(parseDiff({ status: 0, stdout: "R100\0a.ts\0b.ts\0" }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: 0, stdout: "C50\0a.ts\0b.ts\0" }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: 0, stdout: "M" }), { kind: "unreadable" });
  assert.deepEqual(parseDiff({ status: 0, stdout: "A\0ok.ts\0M" }), { kind: "unreadable" });
});

test("checker source is outside the scanned paths", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.deepEqual(judgeCopy({ path: ".github/content/run.ts", text: source }, WORDS), []);
});

function git(repo: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd: repo, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr ?? "");
  return result.stdout ?? "";
}

function initRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "content-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "content@example.test"]);
  git(repo, ["config", "user.name", "content"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

function commitFile(repo: string, filePath: string, text: string): string {
  const absolute = path.join(repo, filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", filePath]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

function runCli(
  repo: string,
  base: string,
  command: string,
  outputPath?: string,
): { readonly status: number | null; readonly stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, BASE_SHA: base };
  if (outputPath === undefined) delete env.GITHUB_OUTPUT;
  else env.GITHUB_OUTPUT = outputPath;
  const result = spawnSync("node", [scriptPath, command], {
    cwd: repo,
    encoding: "utf8",
    env,
    shell: false,
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

test("plan refuses an unknown base and leaves output empty", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "content-plan-"));
  const outputPath = path.join(directory, "github-output.txt");
  try {
    writeFileSync(outputPath, "");
    const result = spawnSync("node", [scriptPath, "plan"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: ZERO_SHA, GITHUB_OUTPUT: outputPath },
      shell: false,
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(outputPath, "utf8"), "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cli plan and copy follow the diff and the committed word list", () => {
  const repo = initRepo();
  const outputDir = mkdtempSync(path.join(tmpdir(), "content-out-"));
  const outputPath = path.join(outputDir, "out.txt");
  try {
    commitFile(repo, "program/banned-words.txt", "# banned\nquote\n");
    const base = git(repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path.join(repo, "docs-only.md"), "Your quote is ready\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "docs"]);
    writeFileSync(outputPath, "");
    const planned = spawnSync("node", [scriptPath, "plan"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: base, GITHUB_OUTPUT: outputPath },
      shell: false,
    });
    assert.equal(planned.status, 0, planned.stderr ?? "");
    assert.equal(readFileSync(outputPath, "utf8"), "scan=false\n");
    rmSync(path.join(repo, "docs-only.md"));
    assert.equal(runCli(repo, base, "copy").status, 0);
    const head = commitFile(repo, "ui/home.ts", 'export const label = "Your quote is ready"\n');
    const diff = spawnSync("git", ["diff", "-z", "--name-status", "--no-renames", `${base}...HEAD`], {
      cwd: repo,
      encoding: "utf8",
      shell: false,
    });
    assert.deepEqual(parseDiff({ status: diff.status, stdout: diff.stdout ?? undefined }), {
      kind: "entries",
      entries: [{ kind: "present", path: "ui/home.ts" }],
    });
    writeFileSync(outputPath, "");
    const full = spawnSync("node", [scriptPath, "plan"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: base, GITHUB_OUTPUT: outputPath },
      shell: false,
    });
    assert.equal(full.status, 0, full.stderr ?? "");
    assert.equal(readFileSync(outputPath, "utf8"), "scan=true\n");
    const copied = runCli(repo, base, "copy");
    assert.equal(copied.status, 1);
    assert.equal(copied.stderr, "ui/home.ts:1:quote\n");
    assert.equal(runCli(repo, head, "copy").status, 0);
    assert.equal(runCli(repo, base, "price-literal").status, 1);
    rmSync(path.join(repo, "ui/home.ts"));
    assert.equal(runCli(repo, base, "copy").status, 1);
    assert.equal(head.length, 40);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

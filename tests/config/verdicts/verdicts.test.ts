import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  evaluateVerdicts,
  eventRunsJob,
  gateFor,
  gitChangedPaths,
  gitPatchId,
  type VerdictInput,
  type VerdictReport,
} from "../../../.github/verdicts/check.js";

const lanes = readFileSync(new URL("../../../program/lanes.yml", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../.github/workflows/verdicts.yml", import.meta.url), "utf8");

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CODE = "abc";
const HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const CTO_CODE = "def";
const CTO_HASH = "cb8379ac2098aa165029e3938a51da0bcecfc008fd6795f401178647f96c5b34";
const APP = "crew-review[bot]";

const STAR_LANES = [
  "qa_paths:",
  '  - "server/*"',
  "risk_paths:",
  '  - "db/**"',
  "design_paths:",
  '  - "ui/**"',
  "",
].join("\n");

type RoleCase = {
  readonly name: string;
  readonly paths: readonly string[];
  readonly labels: readonly string[];
  readonly required: readonly string[];
  readonly lanesYaml?: string;
};

const ROLE_CASES: readonly RoleCase[] = [
  { name: "server", paths: ["server/app.ts"], labels: [], required: ["qa"] },
  { name: "server auth", paths: ["server/auth/session.ts"], labels: [], required: ["cto", "qa"] },
  { name: "db", paths: ["db/migrate.sql"], labels: [], required: ["cto", "qa"] },
  { name: "github", paths: [".github/workflows/verdicts.yml"], labels: [], required: ["cto"] },
  { name: "package", paths: ["package.json"], labels: [], required: ["cto"] },
  { name: "lock", paths: ["package-lock.json"], labels: [], required: ["cto"] },
  { name: "netlify", paths: ["netlify.toml"], labels: [], required: ["cto"] },
  { name: "contracts", paths: ["contracts/job.ts"], labels: [], required: ["cto"] },
  { name: "adapters", paths: ["adapters/vendor.ts"], labels: [], required: ["cto"] },
  { name: "money", paths: ["core/money/cents.ts"], labels: [], required: ["cto"] },
  { name: "ui", paths: ["ui/banner.ts"], labels: [], required: ["designer"] },
  { name: "design", paths: ["design/tokens.css"], labels: [], required: ["designer"] },
  { name: "docs", paths: ["program/lanes.yml"], labels: [], required: [] },
  { name: "readme", paths: ["README.md"], labels: [], required: [] },
  { name: "label qa", paths: ["README.md"], labels: ["verify:qa"], required: ["qa"] },
  { name: "label case", paths: ["README.md"], labels: ["verify:CTO"], required: ["cto"] },
  { name: "label already required", paths: ["server/app.ts"], labels: ["verify:qa"], required: ["qa"] },
  { name: "extra label", paths: ["server/app.ts"], labels: ["verify:designer"], required: ["designer", "qa"] },
  { name: "other label", paths: ["README.md"], labels: ["bug"], required: [] },
  { name: "lookalike path", paths: ["notes/db/a.sql", "server2/app.ts"], labels: [], required: [] },
  { name: "one star file", paths: ["server/app.ts"], labels: [], required: ["qa"], lanesYaml: STAR_LANES },
  { name: "one star nested", paths: ["server/auth/session.ts"], labels: [], required: [], lanesYaml: STAR_LANES },
  { name: "double star nested", paths: ["db/a/b.sql"], labels: [], required: ["cto"], lanesYaml: STAR_LANES },
];

function verdict(outcome: string, role: string, head: string, code: string): string {
  return `${outcome} (${role}) at ${head}\ncode ${code}\n\nChecked the preview.\n`;
}

function fingerprint(role: string, head: string, hash: string): string {
  return `verdict-code ${role} ${head} ${hash}`;
}

function evaluate(overrides: Partial<VerdictInput> & Pick<VerdictInput, "changedPaths">): VerdictReport {
  return evaluateVerdicts({
    labels: [],
    lanesYaml: lanes,
    comments: [],
    reviews: [],
    currentHead: HEAD,
    patchId: () => "same",
    ...overrides,
  });
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

test("required roles come from risk paths and verify labels", () => {
  for (const roleCase of ROLE_CASES) {
    const report = evaluate({
      changedPaths: roleCase.paths,
      labels: roleCase.labels,
      lanesYaml: roleCase.lanesYaml ?? lanes,
    });
    assert.deepEqual(sorted(report.required), sorted(roleCase.required), roleCase.name);
    assert.equal(report.pass, roleCase.required.length === 0, roleCase.name);
  }
});

test("a review app PASS or PASS+NOTES counts", () => {
  for (const outcome of ["PASS", "PASS+NOTES"]) {
    const report = evaluate({
      changedPaths: ["package.json"],
      comments: [{ body: fingerprint("cto", HEAD, HASH) }],
      reviews: [{ login: APP, body: verdict(outcome, "cto", HEAD, CODE) }],
    });
    assert.equal(report.pass, true, outcome);
    assert.deepEqual(report.required, ["cto"]);
  }
});

test("a wrong code does not count", () => {
  const report = evaluate({
    changedPaths: ["package.json"],
    comments: [{ body: fingerprint("cto", HEAD, HASH) }],
    reviews: [{ login: APP, body: verdict("PASS", "cto", HEAD, "zzz") }],
  });
  assert.equal(report.pass, false);
  assert.match(report.message, /wrong code/);
});

test("a code counts once", () => {
  const report = evaluate({
    changedPaths: ["db/migrate.sql"],
    comments: [
      { body: fingerprint("qa", HEAD, HASH) },
      { body: fingerprint("cto", HEAD, HASH) },
    ],
    reviews: [
      { login: APP, body: verdict("PASS", "qa", HEAD, CODE) },
      { login: APP, body: verdict("PASS", "cto", HEAD, CODE) },
    ],
  });
  assert.equal(report.pass, false);
  assert.match(report.message, /cto: reused code/);
});

test("a FAIL does not count", () => {
  const report = evaluate({
    changedPaths: ["package.json"],
    comments: [{ body: fingerprint("cto", HEAD, HASH) }],
    reviews: [{ login: APP, body: verdict("FAIL", "cto", HEAD, CODE) }],
  });
  assert.equal(report.pass, false);
  assert.match(report.message, /FAIL/);
});

test("a review from another account does not count", () => {
  const report = evaluate({
    changedPaths: ["package.json"],
    comments: [{ body: fingerprint("cto", HEAD, HASH) }],
    reviews: [{ login: "cursor[bot]", body: verdict("PASS", "cto", HEAD, CODE) }],
  });
  assert.equal(report.pass, false);
  assert.match(report.message, /another account/);
});

test("two fingerprints for the same role and head fail", () => {
  const report = evaluate({
    changedPaths: ["package.json"],
    comments: [
      { body: fingerprint("cto", HEAD, HASH) },
      { body: fingerprint("cto", HEAD, CTO_HASH) },
    ],
    reviews: [{ login: APP, body: verdict("PASS", "cto", HEAD, CODE) }],
  });
  assert.equal(report.pass, false);
  assert.match(report.message, /two fingerprints for the same role and head/);
  assert.match(report.message, new RegExp(`cto at ${HEAD}`));
});

test("a pull request with no required role passes", () => {
  const report = evaluate({ changedPaths: ["README.md", "program/lanes.yml"] });
  assert.equal(report.pass, true);
  assert.deepEqual(report.required, []);
});

test("the job runs for pull requests, the review app, and verdict-code comments", () => {
  assert.equal(
    eventRunsJob({
      name: "pull_request",
      reviewLogin: null,
      commentBody: null,
      commentOnPullRequest: false,
    }),
    true,
  );
  assert.equal(
    eventRunsJob({
      name: "pull_request_review",
      reviewLogin: APP,
      commentBody: null,
      commentOnPullRequest: false,
    }),
    true,
  );
  assert.equal(
    eventRunsJob({
      name: "pull_request_review",
      reviewLogin: "cursor[bot]",
      commentBody: null,
      commentOnPullRequest: false,
    }),
    false,
  );
  assert.equal(
    eventRunsJob({
      name: "issue_comment",
      reviewLogin: null,
      commentBody: "verdict-code cto abc hash",
      commentOnPullRequest: true,
    }),
    true,
  );
  assert.equal(
    eventRunsJob({
      name: "issue_comment",
      reviewLogin: null,
      commentBody: "thanks",
      commentOnPullRequest: true,
    }),
    false,
  );
  assert.equal(
    eventRunsJob({
      name: "issue_comment",
      reviewLogin: null,
      commentBody: "verdict-code cto abc hash",
      commentOnPullRequest: false,
    }),
    false,
  );
  assert.equal(
    gateFor("pull_request_review", {
      review: { user: { login: "cursor[bot]" } },
      pull_request: { number: 12 },
    }).run,
    false,
  );
  assert.equal(
    gateFor("issue_comment", {
      comment: { body: "verdict-code qa abc hash" },
      issue: { number: 12, pull_request: { url: "https://api.github.com/repos/acme/app/pulls/12" } },
    }).run,
    true,
  );
});

test("the workflow asks only for read and skips unrelated reviews and comments", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /types: \[opened, synchronize, labeled, unlabeled\]/);
  assert.match(workflow, /pull_request_review:/);
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /crew-review\[bot\]/);
  assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'verdict-code'\)/);
  assert.match(workflow, /github\.event\.issue\.pull_request/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version-file: \.nvmrc/);
  assert.match(workflow, /node --experimental-strip-types \.github\/verdicts\/check\.ts/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /:\s*write/);
  assert.doesNotMatch(workflow, /npm (ci|install)/);
  assert.equal(workflow.includes("permissions:"), true);
});

type History = {
  readonly repo: string;
  readonly main0: string;
  readonly main1: string;
  readonly feature: string;
  readonly merged: string;
  readonly outside: string;
  readonly serverFix: string;
  readonly dbFix: string;
  readonly readme: string;
  readonly readmeNext: string;
};

function history(): History {
  const repo = mkdtempSync(path.join(tmpdir(), "verdicts-"));
  const run = (args: readonly string[]): string => {
    const result = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Dev",
        GIT_AUTHOR_EMAIL: "dev@example.test",
        GIT_COMMITTER_NAME: "Dev",
        GIT_COMMITTER_EMAIL: "dev@example.test",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (files: Readonly<Record<string, string>>): string => {
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(repo, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    run(["add", "."]);
    run(["commit", "-q", "-m", "edit"]);
    return run(["rev-parse", "HEAD"]);
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "dev@example.test"]);
  run(["config", "user.name", "Dev"]);
  run(["config", "commit.gpgsign", "false"]);
  const main0 = write({
    "README.md": "base\n",
    "db/schema.sql": "a\n",
    "server/app.ts": "s\n",
    "ui/view.ts": "u\n",
  });
  run(["checkout", "-q", "-b", "feature"]);
  const feature = write({
    "db/schema.sql": "a\nb\n",
    "server/app.ts": "s\nroute\n",
  });
  run(["checkout", "-q", "main"]);
  const main1 = write({ "README.md": "base2\n" });
  run(["checkout", "-q", "feature"]);
  run(["merge", "-q", "--no-edit", "main"]);
  const merged = run(["rev-parse", "HEAD"]);
  run(["checkout", "-q", "-b", "outside", feature]);
  const outside = write({ "README.md": "feature notes\n" });
  run(["checkout", "-q", "-b", "server", feature]);
  const serverFix = write({ "server/app.ts": "s\nroute\nmore\n" });
  run(["checkout", "-q", "-b", "db", feature]);
  const dbFix = write({ "db/schema.sql": "a\nb\nc\n" });
  run(["checkout", "-q", "-b", "readme", main0]);
  const readme = write({ "README.md": "notes\n" });
  const readmeNext = write({ "README.md": "notes\nmore\n" });
  return { repo, main0, main1, feature, merged, outside, serverFix, dbFix, readme, readmeNext };
}

function gitReport(
  repo: string,
  base: string,
  head: string,
  verdictHead: string,
  labels: readonly string[] = [],
): VerdictReport {
  return evaluateVerdicts({
    changedPaths: gitChangedPaths(repo, base, head),
    labels,
    lanesYaml: lanes,
    comments: [
      { body: fingerprint("qa", verdictHead, HASH) },
      { body: fingerprint("cto", verdictHead, CTO_HASH) },
    ],
    reviews: [
      { login: APP, body: verdict("PASS", "qa", verdictHead, CODE) },
      { login: APP, body: verdict("PASS", "cto", verdictHead, CTO_CODE) },
    ],
    currentHead: head,
    patchId: (at, globs) => gitPatchId(repo, base, at, globs),
  });
}

test("patch-id keeps a verdict when its paths are unchanged", () => {
  const repo = history();
  try {
    const updated = gitReport(repo.repo, repo.main1, repo.merged, repo.feature);
    assert.equal(updated.pass, true, updated.message);

    const outside = gitReport(repo.repo, repo.main0, repo.outside, repo.feature, ["verify:qa"]);
    assert.equal(outside.pass, true, outside.message);

    const serverFix = gitReport(repo.repo, repo.main0, repo.serverFix, repo.feature);
    assert.equal(serverFix.pass, false);
    assert.match(serverFix.message, /qa: patch-id/);
    assert.doesNotMatch(serverFix.message, /cto:/);

    const dbFix = gitReport(repo.repo, repo.main0, repo.dbFix, repo.feature);
    assert.equal(dbFix.pass, false);
    assert.match(dbFix.message, /cto: patch-id/);

    const labelKept = gitReport(repo.repo, repo.main0, repo.readme, repo.readme, ["verify:qa"]);
    assert.equal(labelKept.pass, true, labelKept.message);
    assert.deepEqual(labelKept.required, ["qa"]);

    const labelDropped = gitReport(repo.repo, repo.main0, repo.readmeNext, repo.readme, ["verify:qa"]);
    assert.equal(labelDropped.pass, false);
    assert.match(labelDropped.message, /qa: patch-id/);
  } finally {
    rmSync(repo.repo, { recursive: true, force: true });
  }
});

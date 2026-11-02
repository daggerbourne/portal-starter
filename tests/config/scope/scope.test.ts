import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  judgeScope,
  parseLaneMap,
  parseNumstat,
  proofsWithoutRegeneration,
  pullRequestLabels,
  requireCommitSha,
  type ChangedFile,
  type LaneMap,
  type ScopeVerdict,
} from "../../../.github/scope/check.js";

const lanes = parseLaneMap(
  readFileSync(new URL("../../../program/lanes.yml", import.meta.url), "utf8"),
);

function mapWith(
  lanePaths: Readonly<Record<string, readonly string[]>>,
  generated = "  generated_paths: []",
): LaneMap {
  const body = Object.entries(lanePaths)
    .map(([name, paths]) => {
      const lines = paths.map((item) => `      - "${item}"`).join("\n");
      return `  ${name}:\n    paths:\n${lines}`;
    })
    .join("\n");
  return parseLaneMap(
    [
      "lanes:",
      body,
      "size:",
      "  app_lines_max: 400",
      "  test_lines_max: 800",
      "  docs_lines_max: 800",
      "  test_paths:",
      '    - "tests/**/*.test.ts"',
      "  fixture_paths:",
      '    - "tests/**/fixtures/**"',
      "  docs_paths:",
      '    - "**/*.md"',
      generated,
    ].join("\n"),
  );
}

function judge(
  files: readonly ChangedFile[],
  extra: {
    readonly labels?: readonly string[];
    readonly body?: string;
    readonly generated?: readonly { readonly path: string; readonly clean: boolean }[];
  } = {},
  map: LaneMap = lanes,
): ScopeVerdict {
  return judgeScope(map, {
    files,
    labels: extra.labels ?? [],
    body: extra.body ?? "",
    generated: extra.generated ?? [],
  });
}

function changed(path: string, additions: number, deletions = 0): ChangedFile {
  return { path, additions, deletions };
}

test("program/lanes.yml parses to the spec caps", () => {
  assert.equal(lanes.appLinesMax, 400);
  assert.equal(lanes.testLinesMax, 800);
  assert.equal(lanes.docsLinesMax, 800);
});

test("an empty change is in range", () => {
  const verdict = judge([]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lanes, []);
  assert.deepEqual(verdict.lines, { app: 0, test: 0, docs: 0 });
});

test("one lane passes", () => {
  const verdict = judge([changed("server/functions/hello.ts", 10)]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lanes, ["core"]);
});

test("a root file no lane lists counts as config", () => {
  const verdict = judge([changed("hello.html", 4)]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lanes, ["config"]);
});

test("a listed root file keeps its lane", () => {
  const verdict = judge([changed("package.json", 2)]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lanes, ["config"]);
});

test("a path in an unlisted folder fails", () => {
  const verdict = judge([changed("netlify/functions/a.ts", 3)]);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, [
    "netlify/functions/a.ts is in a folder no lane lists",
  ]);
});

test("a star does not cross folders", () => {
  const map = mapWith({ ui: ["ui/*.ts"] });
  assert.deepEqual(judge([changed("ui/a.ts", 1)], {}, map).lanes, ["ui"]);
  const nested = judge([changed("ui/a/b.ts", 1)], {}, map);
  assert.equal(nested.ok, false);
  assert.deepEqual(nested.reasons, ["ui/a/b.ts is in a folder no lane lists"]);
});

test("a path in two lanes fails", () => {
  const verdict = judge([changed("shared/x.ts", 1)], {}, mapWith({
    left: ["shared/**"],
    right: ["shared/**"],
  }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, [
    "shared/x.ts matches more than one lane: left, right",
  ]);
});

test("two lanes fail without the label", () => {
  const verdict = judge(
    [changed("core/a.ts", 1), changed("package.json", 1)],
    { body: "The schema and the workflow ship together." },
  );
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, [
    "cross-lane label is required for lanes config, core",
  ]);
});

test("two lanes fail when the body does not say why", () => {
  for (const body of ["", "   ", "cross-lane", "Cross-lane"]) {
    const verdict = judge(
      [changed("core/a.ts", 1), changed("package.json", 1)],
      { labels: ["cross-lane"], body },
    );
    assert.equal(verdict.ok, false, body);
    assert.deepEqual(verdict.reasons, [
      "pull request body does not say why it spans lanes",
    ]);
  }
});

test("two lanes pass with the label and a reason", () => {
  const verdict = judge(
    [changed("core/a.ts", 1), changed("package.json", 1)],
    {
      labels: ["bug", "cross-lane"],
      body: "The schema and the workflow ship together.",
    },
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lanes, ["config", "core"]);
});

test("caps are separate and include the limit", () => {
  const verdict = judge([
    changed("core/a.ts", 400),
    changed("tests/core/a.test.ts", 400),
    changed("tests/core/fixtures/a.json", 400),
    changed("core/README.md", 800),
  ]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.lines, { app: 400, test: 800, docs: 800 });
});

test("one app line past the cap fails", () => {
  const verdict = judge([changed("core/a.ts", 401)]);
  assert.deepEqual(verdict.reasons, ["app lines 401 exceed 400"]);
});

test("app lines add across files and count deletions", () => {
  assert.equal(judge([changed("core/a.ts", 200), changed("core/b.ts", 200)]).ok, true);
  assert.equal(judge([changed("core/a.ts", 200, 200)]).ok, true);
  const over = judge([changed("core/a.ts", 200), changed("core/b.ts", 201)]);
  assert.deepEqual(over.reasons, ["app lines 401 exceed 400"]);
  const deleted = judge([changed("core/a.ts", 0, 401)]);
  assert.deepEqual(deleted.reasons, ["app lines 401 exceed 400"]);
});

test("one test line past the cap fails", () => {
  const verdict = judge([changed("tests/core/a.test.ts", 801)]);
  assert.deepEqual(verdict.reasons, ["test and fixture lines 801 exceed 800"]);
});

test("tests and fixtures share the cap", () => {
  assert.equal(
    judge([
      changed("tests/core/a.test.ts", 400),
      changed("tests/core/fixtures/a.json", 400),
    ]).ok,
    true,
  );
  const over = judge([
    changed("tests/core/a.test.ts", 400),
    changed("tests/core/fixtures/a.json", 401),
  ]);
  assert.deepEqual(over.reasons, ["test and fixture lines 801 exceed 800"]);
});

test("one docs line past the cap fails", () => {
  const verdict = judge([changed("core/README.md", 801)]);
  assert.deepEqual(verdict.reasons, ["docs lines 801 exceed 800"]);
  assert.equal(verdict.lines.docs, 801);
});

test("a test file outside test_paths counts as app", () => {
  const verdict = judge([changed("core/foo.test.ts", 401)]);
  assert.deepEqual(verdict.reasons, ["app lines 401 exceed 400"]);
});

test("a non-test file under tests counts as app", () => {
  const verdict = judge([changed("tests/core/helper.ts", 401)]);
  assert.deepEqual(verdict.reasons, ["app lines 401 exceed 400"]);
});

test("a test outside every lane folder fails", () => {
  const verdict = judge([changed("tests/stray.test.ts", 1)]);
  assert.deepEqual(verdict.reasons, [
    "tests/stray.test.ts is in a folder no lane lists",
  ]);
});

test("fixture data extensions count toward the test cap", () => {
  for (const ext of ["json", "sql", "csv", "txt", "png", "jpg", "heic", "JSON"]) {
    const verdict = judge([changed(`tests/core/fixtures/sample.${ext}`, 800)]);
    assert.equal(verdict.ok, true, ext);
    assert.equal(verdict.lines.test, 800);
  }
});

test("a fixture that is not data fails", () => {
  for (const path of [
    "tests/core/fixtures/helper.ts",
    "tests/core/fixtures/helper.js",
    "tests/core/fixtures/readme.md",
    "tests/core/fixtures/photo.jpeg",
    "tests/core/fixtures/Makefile",
  ]) {
    const verdict = judge([changed(path, 1)]);
    assert.equal(verdict.ok, false, path);
    assert.deepEqual(verdict.reasons, [
      `${path} is a fixture and is not data (json, sql, csv, txt, png, jpg, heic)`,
    ]);
    assert.deepEqual(verdict.lines, { app: 0, test: 0, docs: 0 });
  }
});

test("a clean generated file is uncounted past the app cap", () => {
  const map = mapWith({ core: ["core/**"] }, '  generated_paths:\n    - "core/schema.json"');
  const file = changed("core/schema.json", 5000);
  const clean = judge([file], { generated: [{ path: file.path, clean: true }] }, map);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.lines, { app: 0, test: 0, docs: 0 });
  const dirty = judge([file], { generated: [{ path: file.path, clean: false }] }, map);
  assert.deepEqual(dirty.reasons, [
    "core/schema.json is generated and the regeneration differs",
  ]);
  const missing = judge([file], {}, map);
  assert.deepEqual(missing.reasons, [
    "core/schema.json is generated and the regeneration differs",
  ]);
});

test("this job does not claim a regeneration it did not run", () => {
  const map = mapWith({ core: ["core/**"] }, '  generated_paths:\n    - "core/schema.json"');
  assert.deepEqual(
    proofsWithoutRegeneration(map, [changed("core/schema.json", 4), changed("core/a.ts", 1)]),
    [{ path: "core/schema.json", clean: false }],
  );
  assert.deepEqual(proofsWithoutRegeneration(lanes, [changed("core/a.ts", 1)]), []);
});

test("numstat keeps the new path and treats binary diffs as zero lines", () => {
  assert.deepEqual(
    parseNumstat(
      [
        "10\t2\tcore/a.ts",
        "-\t-\timage.png",
        "3\t0\told.ts => core/new.ts",
        "1\t0\tcore/{old => new}/file.ts",
        "",
      ].join("\n"),
    ),
    [
      changed("core/a.ts", 10, 2),
      changed("image.png", 0, 0),
      changed("core/new.ts", 3, 0),
      changed("core/new/file.ts", 1, 0),
    ],
  );
});

test("labels and commit shas are rejected at the boundary", () => {
  assert.deepEqual(pullRequestLabels("[]"), []);
  assert.deepEqual(pullRequestLabels('["cross-lane"]'), ["cross-lane"]);
  assert.throws(() => pullRequestLabels("null"));
  assert.throws(() => pullRequestLabels("{}"));
  assert.throws(() => pullRequestLabels("nope"));
  const sha = "a".repeat(40);
  assert.equal(requireCommitSha(sha), sha);
  assert.throws(() => requireCommitSha("HEAD"));
  assert.throws(() => requireCommitSha(`${sha}0`));
});

test("a lanes file without a size map fails closed", () => {
  assert.throws(() => parseLaneMap("lanes:\n  core:\n    paths:\n      - \"core/**\"\n"));
});

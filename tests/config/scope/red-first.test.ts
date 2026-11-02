import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  judgeRedFirst,
  parseLaneMap,
  testFilesToRun,
} from "../../../.github/scope/check.js";

const lanes = parseLaneMap(
  readFileSync(new URL("../../../program/lanes.yml", import.meta.url), "utf8"),
);

test("a first commit that does not touch tests passes", () => {
  assert.deepEqual(judgeRedFirst({ touchedTestPaths: false, failedCount: 0 }), {
    ok: true,
    reasons: [],
  });
});

test("a first commit whose new tests fail passes", () => {
  assert.deepEqual(judgeRedFirst({ touchedTestPaths: true, failedCount: 2 }), {
    ok: true,
    reasons: [],
  });
});

test("a first commit whose new tests all pass fails", () => {
  assert.deepEqual(judgeRedFirst({ touchedTestPaths: true, failedCount: 0 }), {
    ok: false,
    reasons: ["the first commit changes tests and none of them fail"],
  });
});

test("only added or changed files at test_paths are run", () => {
  const status = [
    "A\ttests/config/scope/a.test.ts",
    "M\tcore/a.ts",
    "D\ttests/core/old.test.ts",
    "R100\ttests/core/old-name.test.ts\ttests/core/new-name.test.ts",
    "C100\ttests/core/copied-from.test.ts\ttests/core/copied.test.ts",
    "A\tlib/foo.test.ts",
    "M\ttests/config/scope/b.test.ts",
  ].join("\n");
  assert.deepEqual(testFilesToRun(status, lanes.testPaths), [
    "tests/config/scope/a.test.ts",
    "tests/core/new-name.test.ts",
    "tests/core/copied.test.ts",
    "tests/config/scope/b.test.ts",
  ]);
  assert.deepEqual(testFilesToRun("", lanes.testPaths), []);
});

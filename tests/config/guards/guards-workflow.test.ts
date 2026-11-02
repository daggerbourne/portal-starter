import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { judgeWorkflowPermissions, workflowFacts } from "../../../.github/guards/check.js";

const source = readFileSync(
  path.join(import.meta.dirname, "../../../.github/workflows/guards.yml"),
  "utf8",
);

const FULL_IF = "success() && steps.plan.outputs.depth == 'full'";

test("the guards workflow reads the repo and cancels the previous run", () => {
  assert.equal(source.includes("pull-requests:"), false);
  assert.match(source, /npm ci/);
  assert.ok(source.indexOf("npm ci") < source.indexOf("name: plan\n"));
  assert.equal(source.includes("environment:"), false);
  assert.equal(source.includes("paths:"), false);
  assert.match(source, /^permissions:\n {2}contents: read\n/m);
  assert.match(source, /cancel-in-progress: true/);
  assert.equal(source.split("timeout-minutes: 15").length - 1, 2);
  assert.deepEqual(workflowFacts(source), {
    events: ["pull_request", "push"],
    grants: [{ scope: "contents", access: "read" }],
    environments: [],
  });
  assert.deepEqual(judgeWorkflowPermissions("guards.yml", source), { ok: true });
});

test("ci-permissions reports success on a markdown diff", () => {
  const planAt = source.indexOf("name: plan\n");
  const stepAt = source.lastIndexOf("name: ci-permissions\n");
  assert.notEqual(planAt, -1);
  assert.ok(stepAt > planAt);
  const plan = source.slice(planAt, stepAt);
  const step = source.slice(stepAt);
  assert.equal(plan.includes("if:"), false);
  assert.match(plan, /id: plan/);
  assert.match(plan, /node --experimental-strip-types \.github\/guards\/check\.ts plan/);
  assert.ok(step.includes(`if: "${FULL_IF}"`));
  assert.match(step, /node --experimental-strip-types \.github\/guards\/check\.ts ci-permissions/);
  assert.match(source, /runs-on: ubuntu-latest/);
  assert.match(source, /fetch-depth: "0"/);
  assert.match(source, /persist-credentials: false/);
});

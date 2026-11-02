import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const workflowPath = path.join(repoRoot, ".github/workflows/content.yml");
const WORKFLOW = [
  "name: content",
  "on:",
  "  pull_request:",
  "permissions:",
  "  contents: read",
  "concurrency:",
  "  group: content-${{ github.event.pull_request.number }}",
  "  cancel-in-progress: true",
  "env:",
  "  BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "jobs:",
  "  copy:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 15",
  "    steps:",
  "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  "        with:",
  "          fetch-depth: 0",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  "        with:",
  "          node-version-file: .nvmrc",
  "      - name: plan",
  "        id: plan",
  "        run: node .github/content/run.ts plan",
  "      - name: copy",
  "        if: success() && steps.plan.outputs.scan == 'true'",
  "        run: node .github/content/run.ts copy",
  "",
].join("\n");

test("content workflow text", () => {
  const source = readFileSync(workflowPath, "utf8");
  assert.equal(source, WORKFLOW);
  assert.equal(source.includes("npm"), false);
  assert.equal(source.includes("paths:"), false);
  assert.equal(/\bwrite\b/.test(source), false);
  assert.equal(source.includes("contents: read"), true);
});

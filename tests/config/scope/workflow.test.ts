import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/scope.yml", import.meta.url),
  "utf8",
);

function job(name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, name);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("the scope job installs nothing beyond Node", () => {
  const scope = job("scope");
  assert.equal(scope.includes("npm"), false);
  assert.match(scope, /node \.github\/scope\/check\.js scope/);
  assert.match(scope, /actions\/setup-node@/);
});

test("the token is contents read", () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.equal(workflow.includes("pull-requests:"), false);
  assert.equal(workflow.includes("write"), false);
});

test("red-first is a separate job", () => {
  const redFirst = job("red-first");
  assert.match(redFirst, /node \.github\/scope\/check\.js red-first/);
  assert.match(redFirst, /\*checkout/);
  assert.match(job("scope"), /fetch-depth: 0/);
});

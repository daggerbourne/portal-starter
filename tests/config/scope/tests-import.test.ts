import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const RULE = "app/no-tests-import";

type Snippet = {
  readonly name: string;
  readonly filename: string;
  readonly code: string;
  readonly hits: readonly number[];
};

const SNIPPETS: readonly Snippet[] = [
  {
    name: "app file imports a relative tests module",
    filename: "server/snippet.ts",
    code: 'import { helper } from "../tests/helper.ts"\nexport const value = helper\n',
    hits: [1],
  },
  {
    name: "app file imports a bare tests module",
    filename: "server/snippet.ts",
    code: 'import { helper } from "tests/helper.ts"\nexport const value = helper\n',
    hits: [1],
  },
  {
    name: "app file re-exports from tests",
    filename: "server/snippet.ts",
    code: 'export { helper } from "../tests/helper.ts"\n',
    hits: [1],
  },
  {
    name: "app file dynamically imports tests",
    filename: "server/snippet.ts",
    code: 'export const value = import("../tests/helper.ts")\n',
    hits: [1],
  },
  {
    name: "app file requires tests",
    filename: "server/snippet.js",
    code: 'const helper = require("../tests/helper.ts")\nexport const value = helper\n',
    hits: [1],
  },
  {
    name: "app file imports a neighbor",
    filename: "server/snippet.ts",
    code: 'import { helper } from "./neighbor.ts"\nexport const value = helper\n',
    hits: [],
  },
  {
    name: "app file imports a test folder that is not tests",
    filename: "server/snippet.ts",
    code: 'import { helper } from "../test/helper.ts"\nexport const value = helper\n',
    hits: [],
  },
  {
    name: "a test file imports another test file",
    filename: "tests/config/scope/snippet.test.ts",
    code: 'import { helper } from "./helper.ts"\nexport const value = helper\n',
    hits: [],
  },
];

async function hits(filename: string, code: string): Promise<number[]> {
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintText(code, { filePath: path.join(repoRoot, filename) });
  const result = results[0];
  if (result === undefined) {
    throw new Error("ESLint returned no result");
  }
  return result.messages.filter((message) => message.ruleId === RULE).map((message) => message.line);
}

for (const snippet of SNIPPETS) {
  test(snippet.name, async () => {
    assert.deepEqual(await hits(snippet.filename, snippet.code), snippet.hits);
  });
}

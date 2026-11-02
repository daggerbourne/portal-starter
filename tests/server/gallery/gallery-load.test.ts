import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const REFUSAL = "Portal Starter cannot start in this deploy context.";
const TITLE = "<title>Portal Starter render gallery</title>";
const COPIED = [
  "server/functions/gallery/index.mjs",
  "server/gallery/gallery.mjs",
  "server/gallery/gallery-loader.mjs",
  "core/startup-guard/startup-guard.ts",
];

function placeFunction(): string {
  const root = mkdtempSync(path.join(tmpdir(), "gallery-load-"));
  writeFileSync(path.join(root, "package.json"), '{"type":"commonjs"}\n');
  for (const file of COPIED) {
    const destination = path.join(root, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repoRoot, file), destination);
  }
  return root;
}

function run(root: string, env: Readonly<Record<string, string>>): { readonly status: number; readonly body: string } {
  const script = [
    "import { pathToFileURL } from 'node:url';",
    "const imported = await import(pathToFileURL(process.env.GALLERY_ENTRY).href);",
    "const response = await imported.default();",
    "process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      GALLERY_ENTRY: path.join(root, "server/functions/gallery/index.mjs"),
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return reported(result.stdout);
}

function reported(stdout: string): { readonly status: number; readonly body: string } {
  const parsed: unknown = JSON.parse(stdout);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "status" in parsed &&
    "body" in parsed &&
    typeof parsed.status === "number" &&
    typeof parsed.body === "string"
  ) {
    return { status: parsed.status, body: parsed.body };
  }
  throw new Error("gallery child did not report a response");
}

test("the unbundled gallery function answers under a commonjs package scope", () => {
  const root = placeFunction();
  const refused = run(root, {});
  assert.equal(refused.status, 503);
  assert.equal(refused.body, REFUSAL);

  const open = run(root, {
    MODE: "mock",
    APP_DEPLOY_CONTEXT: "dev",
    APP_PROD_DB_HOST: "app-prod-guard.example.test",
  });
  assert.equal(open.status, 200);
  assert.equal(open.body.includes(TITLE), true);

  const production = run(root, {
    MODE: "mock",
    APP_DEPLOY_CONTEXT: "production",
    APP_PROD_DB_HOST: "app-prod-guard.example.test",
  });
  assert.equal(production.status, 404);
  assert.equal(production.body, "Not found\n");
});

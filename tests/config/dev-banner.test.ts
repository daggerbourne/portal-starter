import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const BANNER = '<p class="dev-banner" role="status">DEV/preview environment. Test data only.</p>';
const ROBOTS = '<meta name="robots" content="noindex, nofollow">';

function build(context: string | undefined, databaseLabel?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dev-banner-"));
  try {
    mkdirSync(path.join(dir, "design"));
    copyFileSync(path.join(repoRoot, "hello.html"), path.join(dir, "hello.html"));
    copyFileSync(path.join(repoRoot, "build-hello.mjs"), path.join(dir, "build-hello.mjs"));
    copyFileSync(path.join(repoRoot, "design/tokens.css"), path.join(dir, "design/tokens.css"));
    writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify({ scripts: { build: "node build-hello.mjs" } })}\n`,
    );
    const env = { ...process.env };
    if (context === undefined) delete env.CONTEXT;
    else env.CONTEXT = context;
    if (databaseLabel === undefined) delete env.APP_DB_LABEL;
    else env.APP_DB_LABEL = databaseLabel;
    const result = spawnSync("npm", ["run", "build"], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    assert.equal(existsSync(path.join(dir, "dist.build")), false);
    return readFileSync(path.join(dir, "dist/portal-starter/index.html"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertPreview(context: string, html: string): void {
  assert.equal(html.includes(BANNER), true, context);
  assert.equal(html.includes(ROBOTS), true, context);
  assert.equal(html.includes("<title>Portal Starter</title>"), true, context);
  assert.equal(html.includes("<h1>Hello</h1>"), true, context);
  assert.equal(html.includes("<button"), false, context);
  assert.equal(html.includes("<script"), false, context);
}

test("deploy-preview, branch-deploy, dev, and an unset context show the dev banner and noindex", () => {
  const contexts: readonly (string | undefined)[] = ["deploy-preview", "branch-deploy", "dev", undefined];
  for (const context of contexts) {
    assertPreview(context ?? "unset", build(context));
  }
  assertPreview("empty", build(""));
  assertPreview("not exact production", build("Production"));
});

test("the production context publishes hello.html with no dev banner and no noindex", () => {
  const html = build("production");
  assert.equal(html, readFileSync(path.join(repoRoot, "hello.html"), "utf8"));
  assert.equal(html.includes("DEV/preview environment"), false);
  assert.equal(html.includes("noindex"), false);
});

test("a set APP_DB_LABEL is appended to the dev banner and escaped", () => {
  const plain = build("deploy-preview", "preview/pr-12");
  assert.equal(
    plain.includes(
      '<p class="dev-banner" role="status">DEV/preview environment. Test data only. preview/pr-12</p>',
    ),
    true,
  );
  assert.equal(plain.includes(BANNER), false);

  const marked = build("deploy-preview", 'preview/pr-12 <"dev">&');
  assert.equal(
    marked.includes(
      '<p class="dev-banner" role="status">DEV/preview environment. Test data only. preview/pr-12 &lt;&quot;dev&quot;&gt;&amp;</p>',
    ),
    true,
  );
  assert.equal(marked.includes('<"dev">&'), false);
  assert.equal(marked.includes(BANNER), false);
});

test("an unset or blank APP_DB_LABEL leaves the dev banner unchanged", () => {
  const labels: readonly (string | undefined)[] = [undefined, "", "   "];
  for (const label of labels) {
    const html = build("deploy-preview", label);
    assert.equal(html.includes(BANNER), true, label ?? "unset");
    assert.equal(html.includes("preview/pr-"), false, label ?? "unset");
  }
});

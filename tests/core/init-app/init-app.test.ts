import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyIdentity, checkIdentity, initApp, parseArgs, pascalCase, type AppIdentity } from "../../../scripts/init-app.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const ACME: AppIdentity = {
  name: "Acme Portal",
  slug: "acme-portal",
  repo: "acme-portal",
  reviewApp: "acme-review",
  tenantId: "11111111-2222-4333-8444-555555555555",
  clientId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};

test("pascal case joins words", () => {
  assert.equal(pascalCase("acme  portal"), "AcmePortal");
});

test("identity checks refuse bad names, slugs, and ids", () => {
  assert.deepEqual(checkIdentity(ACME), []);
  assert.equal(checkIdentity({ ...ACME, slug: "Acme_Portal" }).length, 1);
  assert.equal(checkIdentity({ ...ACME, slug: "portal-starter" }).length, 1);
  assert.equal(checkIdentity({ ...ACME, name: "<script>" }).length, 1);
  assert.equal(checkIdentity({ ...ACME, tenantId: "not-a-guid" }).length, 1);
  assert.equal(checkIdentity({ ...ACME, reviewApp: "" }).length, 1);
  assert.equal(checkIdentity({ ...ACME, reviewApp: "Bad App" }).length, 1);
});

test("arguments default the repo to the slug", () => {
  const parsed = parseArgs(["--name", "Acme Portal", "--slug", "acme-portal"]);
  assert.equal(parsed.repo, "acme-portal");
  assert.equal(parsed.reviewApp, "");
  assert.equal(parsed.tenantId, undefined);
  assert.throws(() => parseArgs(["--name"]));
});

test("every template name form is replaced", () => {
  const text = 'title Portal Starter role PortalStarter.Staff lower portalstarter.staff path /portal-starter/admin issue daggerbourne\\/portal-starter/issues app crew-review[bot]';
  assert.equal(
    applyIdentity("x.ts", text, ACME),
    'title Acme Portal role AcmePortal.Staff lower acmeportal.staff path /acme-portal/admin issue daggerbourne\\/acme-portal/issues app acme-review[bot]',
  );
});

test("entra ids are written only into the auth config, as joined parts", () => {
  const config = readFileSync(path.join(repoRoot, "server/auth/config.ts"), "utf8");
  const out = applyIdentity("server/auth/config.ts", config, ACME);
  assert.match(out, /DEFAULT_ENTRA_TENANT_ID = \["11111111", "2222", "4333", "8444", "555555555555"\]/);
  assert.match(out, /DEFAULT_ENTRA_CLIENT_ID = \["aaaaaaaa", "bbbb", "4ccc", "8ddd", "eeeeeeeeeeee"\]/);
  assert.equal(out.includes("11111111-2222"), false);
  assert.equal(applyIdentity("other.ts", 'DEFAULT_ENTRA_TENANT_ID = ["00000000", "0000", "0000", "0000", "000000000000"]', ACME).includes("11111111"), false);
});

test("running it on a copy leaves no template name behind", () => {
  const work = mkdtempSync(path.join(tmpdir(), "init-app-"));
  try {
    const skip = new Set([".git", "node_modules", "dist", "dist.build"]);
    cpSync(repoRoot, work, { recursive: true, filter: (source) => !skip.has(path.basename(source)) });
    for (const args of [["init", "--quiet"], ["add", "-A"]]) {
      assert.equal(spawnSync("git", args, { cwd: work, encoding: "utf8", shell: false }).status, 0);
    }
    assert.equal(initApp(work, ACME) > 0, true);
    const grep = spawnSync("git", ["grep", "-n", "-i", "-e", "portal-starter", "-e", "portal starter", "-e", "portalstarter", "-e", "crew-review", "--", ".", ":!scripts/init-app.ts", ":!tests/core/init-app"], {
      cwd: work,
      encoding: "utf8",
      shell: false,
    });
    assert.equal(grep.stdout, "");
    assert.match(readFileSync(path.join(work, "server/functions/admin-users.ts"), "utf8"), /path: "\/acme-portal\/admin"/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

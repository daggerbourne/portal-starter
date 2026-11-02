import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type AppIdentity = {
  readonly name: string;
  readonly slug: string;
  readonly repo: string;
  readonly reviewApp: string;
  readonly tenantId: string | undefined;
  readonly clientId: string | undefined;
};

const TEMPLATE = { name: "Portal Starter", pascal: "PortalStarter", slug: "portal-starter", repo: "portal-starter", reviewApp: "crew-review" } as const;
const APP_LOGIN = /^[a-z0-9][a-z0-9-]{0,33}[a-z0-9]$/;
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const NAME = /^[A-Za-z][A-Za-z0-9 ]{1,39}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_PARTS = '["00000000", "0000", "0000", "0000", "000000000000"]';
const BINARY = /\.(png|ico|gif|jpg|jpeg|webp|mp4|woff2?)$/i;

export function pascalCase(name: string): string {
  return name
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join("");
}

export function checkIdentity(identity: AppIdentity): readonly string[] {
  const problems: string[] = [];
  if (!NAME.test(identity.name)) problems.push("--name must be 2 to 40 letters, digits, or spaces, starting with a letter");
  if (!SLUG.test(identity.slug)) problems.push("--slug must be 3 to 40 lowercase letters, digits, or hyphens");
  if (!SLUG.test(identity.repo.toLowerCase())) problems.push("--repo must look like a repository name");
  if (identity.tenantId !== undefined && !GUID.test(identity.tenantId)) problems.push("--entra-tenant must be a GUID");
  if (identity.clientId !== undefined && !GUID.test(identity.clientId)) problems.push("--entra-client must be a GUID");
  if (identity.slug === TEMPLATE.slug) problems.push("--slug must differ from the template slug");
  if (!APP_LOGIN.test(identity.reviewApp)) problems.push("--review-app must be the verdict GitHub App's slug, for example my-review");
  return problems;
}

function guidParts(guid: string): string {
  return `[${guid.toLowerCase().split("-").map((part) => `"${part}"`).join(", ")}]`;
}

export function applyIdentity(filePath: string, text: string, identity: AppIdentity): string {
  let out = text
    .replaceAll(`daggerbourne\\/${TEMPLATE.repo}`, `daggerbourne\\/${identity.repo}`)
    .replaceAll(`daggerbourne/${TEMPLATE.repo}`, `daggerbourne/${identity.repo}`)
    .replaceAll(TEMPLATE.name, identity.name)
    .replaceAll(TEMPLATE.pascal, pascalCase(identity.name))
    .replaceAll(TEMPLATE.pascal.toLowerCase(), pascalCase(identity.name).toLowerCase())
    .replaceAll(TEMPLATE.slug, identity.slug)
    .replaceAll(TEMPLATE.reviewApp, identity.reviewApp);
  if (filePath === "server/auth/config.ts") {
    if (identity.tenantId !== undefined) {
      out = out.replace(`DEFAULT_ENTRA_TENANT_ID = ${ZERO_PARTS}`, `DEFAULT_ENTRA_TENANT_ID = ${guidParts(identity.tenantId)}`);
    }
    if (identity.clientId !== undefined) {
      out = out.replace(`DEFAULT_ENTRA_CLIENT_ID = ${ZERO_PARTS}`, `DEFAULT_ENTRA_CLIENT_ID = ${guidParts(identity.clientId)}`);
    }
  }
  return out;
}

export function parseArgs(argv: readonly string[]): AppIdentity {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--")) throw new Error(`unexpected argument ${String(flag)}`);
    values.set(flag.slice(2), value);
  }
  const name = values.get("name") ?? "";
  const slug = values.get("slug") ?? "";
  return {
    name,
    slug,
    repo: values.get("repo") ?? slug,
    reviewApp: values.get("review-app") ?? "",
    tenantId: values.get("entra-tenant"),
    clientId: values.get("entra-client"),
  };
}

function trackedFiles(root: string): readonly string[] {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false });
  if (listed.status !== 0 || typeof listed.stdout !== "string") throw new Error("git ls-files failed");
  return listed.stdout.split("\0").filter((file) => file !== "" && !BINARY.test(file) && file !== "scripts/init-app.ts" && !file.startsWith("tests/core/init-app/"));
}

export function initApp(root: string, identity: AppIdentity): number {
  let changed = 0;
  for (const file of trackedFiles(root)) {
    const absolute = path.join(root, file);
    const before = readFileSync(absolute, "utf8");
    const after = applyIdentity(file, before, identity);
    if (after !== before) {
      writeFileSync(absolute, after);
      changed += 1;
    }
  }
  return changed;
}

function run(): void {
  const identity = parseArgs(process.argv.slice(2));
  const problems = checkIdentity(identity);
  if (problems.length > 0) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.stderr.write('usage: npx tsx scripts/init-app.ts --name "Acme Portal" --slug acme-portal --review-app <github-app-slug> [--repo acme-portal] [--entra-tenant <guid>] [--entra-client <guid>]\n');
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changed = initApp(root, identity);
  process.stdout.write(`updated ${String(changed)} files for ${identity.name} (${identity.slug})\n`);
  process.stdout.write("next: run npm test, commit, then follow program/setup.md\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) run();

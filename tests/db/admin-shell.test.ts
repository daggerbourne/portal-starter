import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SETTINGS_KEYS } from "../../contracts/domain.js";
import { entraIds } from "../../server/auth/config.js";
import { handleCallback, handleLogin, type AuthDeps } from "../../server/auth/staff-sign-in.js";
import { productionAuthDeps } from "../../server/auth/wire.js";
import { postgresUserDirectory } from "../../server/portal/user-directory.js";
import adminUser from "../../server/functions/admin-user.js";
import adminUsers from "../../server/functions/admin-users.js";
import adminSettings from "../../server/functions/admin-settings.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? "";
const hasDatabase = databaseUrl.length > 0;
const KEY = "synthetic-session-key";
const LABEL = "synthetic-dev";
const HOSTILE_OID = "'); DROP TABLE staff;--";
const HOSTILE_USER = "1'; DROP TABLE app_user;--";


const saved = new Map<string, string | undefined>();
let freshUrl = "";
let freshName = "";

function adminUrl(url: string): URL {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return admin;
}

function runMigrate(url: string): void {
  const run = spawnSync("npm", ["run", "migrate"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

async function query<T extends Record<string, unknown>>(url: string, sql: string, values: readonly unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<T>(sql, [...values]);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function catalog(url: string): Promise<string> {
  const rows = await query<{ line: string }>(
    url,
    `SELECT c.relname || '|' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' || pg_get_constraintdef(con.oid) AS line
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_constraint con ON con.conrelid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1`,
  );
  return rows.map((row) => row.line).join("\n");
}

function keep(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function unsignedIdToken(claims: { readonly [key: string]: unknown }): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.unsigned`;
}

async function callbackFor(
  objectId: string,
  staffClaim = true,
): Promise<{ status: number; cookie: string; text: string }> {
  const wired = productionAuthDeps();
  const tokens = new Map<string, string>();
  const deps: AuthDeps = {
    ...wired,
    mockIdToken: (code) => tokens.get(code),
    transport: () => Promise.reject(new Error("transport called")),
    audit: { write() { return undefined; } },
  };
  const login = handleLogin(new Request("http://localhost:8888/portal-starter/auth/login"), deps);
  const location = new URL(login.headers.get("location") ?? "http://invalid.example/");
  const ids = entraIds(deps.env);
  const code = "synthetic-code";
  tokens.set(code, unsignedIdToken({
    iss: `https://login.microsoftonline.com/${ids.tenantId}/v2.0`,
    aud: ids.clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: location.searchParams.get("nonce"),
    oid: objectId,
    email: "person@example.test",
    roles: staffClaim ? ["PortalStarter.Staff"] : ["owner"],
  }));
  const ticket = login.headers.getSetCookie().find((item) => item.startsWith("app_login="))?.split(";")[0] ?? "";
  const callback = await handleCallback(
    new Request(`http://localhost:8888/portal-starter/auth/callback?code=${code}&state=${encodeURIComponent(location.searchParams.get("state") ?? "")}`, {
      headers: { cookie: ticket, role: "owner" },
    }),
    deps,
  );
  const cookie = callback.headers.getSetCookie().find((item) => item.startsWith("app_session="))?.split(";")[0] ?? "";
  return { status: callback.status, cookie, text: await callback.text() };
}

async function seedUser(displayName: string, state: "invited" | "active" | "suspended", archived = false): Promise<string> {
  const rows = await query<{ id: string }>(
    freshUrl,
    "INSERT INTO app_user (provider, subject, email, display_name, state, suspended_reason, created_by, archived_at) VALUES ('stub', $1, $2, $3, $4::user_state, $5, 'test', $6) RETURNING id",
    [`subject-${displayName}`, `${displayName.toLowerCase().replaceAll(" ", ".")}@example.test`, displayName, state, state === "suspended" ? "synthetic reason" : null, archived ? new Date().toISOString() : null],
  );
  const id = rows[0]?.id;
  assert.ok(id);
  return id;
}

test("the staff migration does not seed or delete", () => {
  const names = readdirSync(path.join(repoRoot, "db")).filter((name) => name.endsWith("_staff.sql"));
  assert.deepEqual(names, ["20261101T0654_staff.sql"]);
  const text = readFileSync(path.join(repoRoot, "db", names[0] ?? ""), "utf8");
  assert.doesNotMatch(text, /\bINSERT\b/i);
  assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
  assert.match(text, /entra_object_id text NOT NULL/);
  assert.match(text, /display_name text NOT NULL/);
  assert.match(text, /CHECK \(role IN \('staff', 'owner'\)\)/);
});

describe("admin shell on postgres", { skip: hasDatabase ? false : "DATABASE_URL is unset", concurrency: 1 }, () => {
  before(async () => {
    const name = `m00p_${randomBytes(4).toString("hex")}`;
    freshName = name;
    const admin = new Client({ connectionString: adminUrl(databaseUrl).toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${name}`);
    } finally {
      await admin.end();
    }
    const next = new URL(databaseUrl);
    next.pathname = `/${name}`;
    freshUrl = next.toString();
    runMigrate(freshUrl);
    keep("DATABASE_URL", freshUrl);
    keep("APP_SESSION_KEY", KEY);
    keep("APP_DEPLOY_CONTEXT", "dev");
    keep("APP_PROD_DB_HOST", "app-prod-guard.example.test");
    keep("APP_DB_LABEL", LABEL);
    keep("MODE", "mock");
  });

  after(async () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (freshName === "") return;
    const admin = new Client({ connectionString: adminUrl(databaseUrl).toString() });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE ${freshName} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  test("the staff migration applies once and a second apply changes nothing", async () => {
    const beforeCatalog = await catalog(freshUrl);
    const count = await query<{ n: number }>(freshUrl, "SELECT count(*)::int AS n FROM staff");
    assert.equal(count[0]?.n, 0);
    runMigrate(freshUrl);
    assert.equal(await catalog(freshUrl), beforeCatalog);
    const sql = readFileSync(path.join(repoRoot, "db/20261101T0654_staff.sql"), "utf8");
    const client = new Client({ connectionString: freshUrl });
    await client.connect();
    try {
      await client.query(sql);
      await client.query("BEGIN");
      await client.query("SAVEPOINT role_check");
      await assert.rejects(client.query("INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ('oid-customer', 'visitor@example.test', 'Visitor', 'user', 'test')"));
      await client.query("ROLLBACK TO SAVEPOINT role_check");
      await client.query("INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ('oid-once', 'ada@example.test', 'Ada Example', 'staff', 'test')");
      await client.query("SAVEPOINT object_id");
      await assert.rejects(client.query("INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ('oid-once', 'ada@example.test', 'Ada Example', 'owner', 'test')"));
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
    assert.equal(await catalog(freshUrl), beforeCatalog);
    const columns = await query<{ column_name: string; udt_name: string; is_nullable: string }>(
      freshUrl,
      "SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff' ORDER BY ordinal_position",
    );
    assert.deepEqual(columns.map((row) => row.column_name), ["id", "entra_object_id", "email", "display_name", "role", "created_at", "updated_at", "created_by", "archived_at"]);
    assert.equal(columns.find((row) => row.column_name === "role")?.udt_name, "role");
    assert.equal(columns.find((row) => row.column_name === "archived_at")?.is_nullable, "YES");
    assert.ok(columns.filter((row) => row.column_name !== "archived_at").every((row) => row.is_nullable === "NO"));
  });

  test("a seeded staff oid signs in and an archived, unknown, or non-staff row does not", async () => {
    await query(freshUrl, "INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ($1, $2, $3, $4, 'test')", ["oid-staff", "ada@example.test", "Ada Example", "staff"]);
    await query(freshUrl, "INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ($1, $2, $3, $4, 'test')", ["oid-owner", "owner@example.test", "Owen Example", "owner"]);
    await query(freshUrl, "INSERT INTO staff (entra_object_id, email, display_name, role, created_by, archived_at) VALUES ($1, $2, $3, $4, 'test', now())", ["oid-archived", "archived@example.test", "Archived Example", "staff"]);
    const staff = await callbackFor("oid-staff");
    assert.equal(staff.status, 302);
    assert.match(staff.cookie, /^app_session=/);
    assert.equal(staff.cookie.includes("ada@example.test"), false);
    assert.equal(staff.cookie.includes("Ada Example"), false);
    assert.equal(staff.text.includes("postgres://"), false);
    const archived = await callbackFor("oid-archived", false);
    const unknown = await callbackFor("oid-unknown", false);
    const hostile = await callbackFor(HOSTILE_OID, false);
    assert.equal(archived.status, 403);
    assert.equal(unknown.status, 403);
    assert.equal(hostile.status, 403);
    const still = await query<{ n: number }>(freshUrl, "SELECT count(*)::int AS n FROM staff");
    assert.equal(still[0]?.n, 3);
    const client = new Client({ connectionString: freshUrl });
    await client.connect();
    try {
      await client.query("ALTER TABLE staff DROP CONSTRAINT staff_role_check");
      await client.query("INSERT INTO staff (entra_object_id, email, display_name, role, created_by) VALUES ('oid-customer', 'visitor@example.test', 'Visitor', 'user', 'test')");
    } finally {
      await client.end();
    }
    const customer = await callbackFor("oid-customer", false);
    assert.equal(customer.status, 403);
    const page = await adminUsers(new Request("http://localhost/portal-starter/admin", { headers: { cookie: staff.cookie } }));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Role: Staff/);
  });

  test("the users list shows live users and hides archived ones", async () => {
    await seedUser("Ada Hollow", "active");
    await seedUser("Nico Vale", "invited");
    await seedUser("June Peck", "suspended");
    await seedUser("Gone Archived", "active", true);
    const staff = await callbackFor("oid-staff");
    const response = await adminUsers(new Request("http://localhost/portal-starter/admin", { headers: { cookie: staff.cookie } }));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html.includes("DEV/preview environment. Test data only."), true);
    assert.equal(html.includes(LABEL), true);
    assert.equal(html.includes('<meta name="robots" content="noindex, nofollow">'), true);
    assert.equal(html.includes('href="/portal-starter/tokens.css"'), true);
    for (const name of ["Ada Hollow", "Nico Vale", "June Peck"]) assert.equal(html.includes(name), true, name);
    assert.equal(html.includes("Gone Archived"), false);
    assert.equal(html.includes("active 1"), true);
    assert.equal(html.includes("invited 1"), true);
    assert.equal(html.includes("suspended 1"), true);
  });

  test("a user page reads the user and an unknown, archived, or malformed id is not found", async () => {
    const id = await seedUser("Page Reader", "suspended");
    const staff = await callbackFor("oid-staff");
    const page = await adminUser(new Request(`http://localhost/portal-starter/admin/users/${id}`, { headers: { cookie: staff.cookie } }));
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal(html.includes("Page Reader"), true);
    assert.equal(html.includes("page.reader@example.test"), true);
    assert.equal(html.includes("synthetic reason"), true);
    assert.equal(html.includes("Role: Staff"), true);
    await query(freshUrl, "UPDATE app_user SET archived_at = now() WHERE id = $1", [id]);
    const archived = await adminUser(new Request(`http://localhost/portal-starter/admin/users/${id}`, { headers: { cookie: staff.cookie } }));
    assert.equal(archived.status, 404);
    const unknown = await adminUser(new Request("http://localhost/portal-starter/admin/users/00000000-0000-4000-8000-000000000000", { headers: { cookie: staff.cookie } }));
    assert.equal(unknown.status, 404);
    const before = await query<{ n: number }>(freshUrl, "SELECT count(*)::int AS n FROM app_user");
    const hostile = await adminUser(new Request(`http://localhost/portal-starter/admin/users/${encodeURIComponent(HOSTILE_USER)}`, { headers: { cookie: staff.cookie } }));
    assert.equal(hostile.status, 404);
    const afterCount = await query<{ n: number }>(freshUrl, "SELECT count(*)::int AS n FROM app_user");
    assert.equal(afterCount[0]?.n, before[0]?.n);
    const live = await seedUser("Prod Reader", "active");
    keep("APP_DEPLOY_CONTEXT", "production");
    const production = await adminUser(new Request(`http://localhost/portal-starter/admin/users/${live}`, { headers: { cookie: staff.cookie } }));
    keep("APP_DEPLOY_CONTEXT", "dev");
    const productionHtml = await production.text();
    assert.equal(production.status, 200);
    assert.equal(productionHtml.includes("DEV/preview environment"), false);
    assert.equal(productionHtml.includes("app-dev-banner"), false);
  });

  test("the user directory creates once per identity and moves state", async () => {
    const directory = postgresUserDirectory({ databaseUrl: () => freshUrl });
    const identity = { provider: "stub", subject: "directory-subject", email: "dir@example.test", displayName: "Dir Example" };
    assert.equal(await directory.findByIdentity(identity), undefined);
    const created = await directory.create(identity, "active");
    assert.equal(created.state, "active");
    const again = await directory.create(identity, "active");
    assert.equal(again.id, created.id);
    assert.deepEqual(await directory.findById(created.id), created);
    assert.deepEqual(await directory.findByIdentity(identity), created);
    assert.equal(await directory.findById("not-a-uuid"), undefined);
    const invited = await directory.create({ ...identity, subject: "directory-invited" }, "invited");
    const moved = await directory.setState(invited.id, "active");
    assert.equal(moved.state, "active");
  });

  test("settings is owner-only and shows the current value of each key", async () => {
    await query(freshUrl, "INSERT INTO settings (key, version, value, created_by) VALUES ('display_name', 1, '\"Stale Name\"'::jsonb, 'test')");
    await query(freshUrl, "INSERT INTO settings (key, version, value, created_by) VALUES ('display_name', 2, '\"Fresh Name\"'::jsonb, 'test')");
    const staff = await callbackFor("oid-staff");
    const owner = await callbackFor("oid-owner");
    const refused = await adminSettings(new Request("http://localhost/portal-starter/admin/settings", { headers: { cookie: staff.cookie } }));
    assert.equal(refused.status, 403);
    const page = await adminSettings(new Request("http://localhost/portal-starter/admin/settings", { headers: { cookie: owner.cookie } }));
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal(html.includes("Role: Owner"), true);
    assert.equal(html.includes("Fresh Name"), true);
    assert.equal(html.includes("Stale Name"), false);
    for (const key of SETTINGS_KEYS) assert.equal(html.includes(key), true, key);
    assert.equal(html.includes("Not set"), true);
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { SETTINGS_KEYS } from "../../contracts/domain.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? "";
const hasDatabase = databaseUrl.length > 0;

const BASE_TABLES = ["settings", "audit", "staff", "app_user"] as const;

const AUDIT_COLUMNS = ["id", "created_at", "updated_at", "created_by", "archived_at"] as const;


type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
};

type EnumRow = {
  typname: string;
  enumlabel: string;
};

function runMigrate(url: string): void {
  const run = spawnSync("npm", ["run", "migrate"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr ?? run.stdout ?? "migrate failed");
}

function sourceFiles(): string[] {
  const files: string[] = [];
  const dbDir = path.join(repoRoot, "db");
  if (existsSync(dbDir)) {
    for (const name of readdirSync(dbDir)) {
      if (name.endsWith(".sql") || name.endsWith(".ts")) files.push(path.join(dbDir, name));
    }
  }
  const script = path.join(repoRoot, "scripts", "migrate.ts");
  if (existsSync(script)) files.push(script);
  return files;
}

function enumLabels(sql: string): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const match of sql.matchAll(/CREATE TYPE ([a-z0-9_]+) AS ENUM \(([^)]*)\)/g)) {
    const typeName = match[1];
    const body = match[2];
    if (typeName === undefined || body === undefined) continue;
    labels.set(typeName, [...body.matchAll(/'([a-z0-9_]+)'/g)].map((item) => item[1] ?? ""));
  }
  return labels;
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
  const columns = await query<{ line: string }>(
    url,
    `SELECT c.relname || '|' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull AS line
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`,
  );
  const constraints = await query<{ line: string }>(
    url,
    `SELECT c.relname || '|' || pg_get_constraintdef(con.oid) AS line
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY c.relname, pg_get_constraintdef(con.oid)`,
  );
  const triggers = await query<{ line: string }>(
    url,
    `SELECT c.relname || '|' || t.tgname AS line
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname`,
  );
  return [...columns, ...constraints, ...triggers].map((row) => row.line).join("\n");
}

let freshUrlPromise: Promise<string> | undefined;
let freshName = "";

function adminUrl(url: string): URL {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return admin;
}

async function freshUrl(): Promise<string> {
  freshUrlPromise ??= (async () => {
    const name = `m00f_${randomBytes(4).toString("hex")}`;
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error("database name");
    freshName = name;
    const admin = adminUrl(databaseUrl);
    const client = new Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE ${name}`);
    } finally {
      await client.end();
    }
    const next = new URL(databaseUrl);
    next.pathname = `/${name}`;
    return next.toString();
  })();
  return freshUrlPromise;
}

after(async () => {
  if (freshName === "") return;
  const admin = adminUrl(databaseUrl);
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE ${freshName} WITH (FORCE)`);
  } finally {
    await client.end();
  }
});

test("migration sources do not cascade or delete", () => {
  const files = sourceFiles();
  assert.ok(files.some((file) => file.endsWith(".sql")));
  assert.ok(files.some((file) => file.endsWith(`${path.sep}migrate.ts`) || file.endsWith("/migrate.ts")));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i, file);
    assert.doesNotMatch(text, /\bON\s+DELETE\s+CASCADE\b/i, file);
  }
});

test("migrate refuses a missing DATABASE_URL", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const run = spawnSync("npm", ["run", "migrate"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr ?? "", /DATABASE_URL is required/);
});

test("migrate records each version and a second run leaves the schema", { skip: hasDatabase ? false : "DATABASE_URL is unset" }, async () => {
  const url = await freshUrl();
  runMigrate(url);
  const before = await catalog(url);
  const versions = await query<{ version: string }>(url, "SELECT version FROM schema_migration ORDER BY version");
  const expected = readdirSync(path.join(repoRoot, "db")).filter((name) => /^[0-9]{8}T[0-9]{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.deepEqual(versions.map((row) => row.version), expected);
  runMigrate(url);
  const after = await catalog(url);
  const again = await query<{ version: string }>(url, "SELECT version FROM schema_migration ORDER BY version");
  assert.equal(after, before);
  assert.deepEqual(again, versions);
});

test("base tables carry the audit columns and no floats", { skip: hasDatabase ? false : "DATABASE_URL is unset" }, async () => {
  const url = await freshUrl();
  runMigrate(url);
  const rows = await query<ColumnRow>(
    url,
    `SELECT table_name, column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  );
  for (const table of BASE_TABLES) {
    const names = new Set(rows.filter((row) => row.table_name === table).map((row) => row.column_name));
    for (const column of AUDIT_COLUMNS) assert.ok(names.has(column), `${table}.${column}`);
  }
  const floats = rows.filter((row) => row.data_type === "numeric" || row.data_type === "real" || row.data_type === "double precision");
  assert.deepEqual(floats, []);
  const userState = rows.find((row) => row.table_name === "app_user" && row.column_name === "state");
  assert.equal(userState?.udt_name, "user_state");
  const baseTables = new Set<string>(BASE_TABLES);
  const createdBy = rows.filter((row) => baseTables.has(row.table_name) && row.column_name === "created_by");
  assert.equal(createdBy.length, BASE_TABLES.length);
  assert.ok(createdBy.every((row) => row.is_nullable === "NO" && row.data_type === "text"));
});

test("database enums match contracts/generated/enums.sql", { skip: hasDatabase ? false : "DATABASE_URL is unset" }, async () => {
  const url = await freshUrl();
  runMigrate(url);
  const sql = readFileSync(path.join(repoRoot, "contracts/generated/enums.sql"), "utf8");
  const expected = enumLabels(sql);
  const rows = await query<EnumRow>(
    url,
    `SELECT t.typname, e.enumlabel
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     ORDER BY t.typname, e.enumsortorder`,
  );
  const actual = new Map<string, string[]>();
  for (const row of rows) {
    const list = actual.get(row.typname) ?? [];
    list.push(row.enumlabel);
    actual.set(row.typname, list);
  }
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [typeName, labels] of expected) assert.deepEqual(actual.get(typeName), labels);
});

test("settings keys and foreign keys match the domain", { skip: hasDatabase ? false : "DATABASE_URL is unset" }, async () => {
  const url = await freshUrl();
  runMigrate(url);
  const checks = await query<{ definition: string }>(
    url,
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conname = 'settings_key'`,
  );
  assert.equal(checks.length, 1);
  const definition = checks[0]?.definition ?? "";
  for (const key of SETTINGS_KEYS) assert.match(definition, new RegExp(`'${key}'`));
  const foreignKeys = await query<{ confdeltype: string }>(
    url,
    `SELECT con.confdeltype
     FROM pg_constraint con
     JOIN pg_namespace n ON n.oid = con.connamespace
     WHERE n.nspname = 'public' AND con.contype = 'f'`,
  );
  assert.ok(foreignKeys.every((row) => row.confdeltype === "a"));
});

test("a user identity is unique and suspension needs a reason", { skip: hasDatabase ? false : "DATABASE_URL is unset" }, async () => {
  const url = await freshUrl();
  runMigrate(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO app_user (provider, subject, email, display_name, created_by) VALUES ('stub', 'subject-1', 'ada@example.test', 'Ada', 'system')",
    );
    await client.query("SAVEPOINT duplicate");
    await assert.rejects(
      client.query(
        "INSERT INTO app_user (provider, subject, email, display_name, created_by) VALUES ('stub', 'subject-1', 'other@example.test', 'Other', 'system')",
      ),
    );
    await client.query("ROLLBACK TO SAVEPOINT duplicate");
    await assert.rejects(
      client.query(
        "INSERT INTO app_user (provider, subject, email, display_name, state, created_by) VALUES ('stub', 'subject-2', 'b@example.test', 'B', 'suspended', 'system')",
      ),
    );
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await assert.rejects(
      client.query(
        "INSERT INTO app_user (provider, subject, email, display_name, state, created_by) VALUES ('stub', 'subject-3', 'c@example.test', 'C', 'expired', 'system')",
      ),
    );
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATION_NAME = /^[0-9]{8}T[0-9]{4}_[a-z0-9_]+\.sql$/;

const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export type MigrateResult = {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

function listMigrations(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => MIGRATION_NAME.test(name))
    .sort();
}

async function recorded(client: Client, version: string): Promise<boolean> {
  const found = await client.query("SELECT version FROM schema_migration WHERE version = $1", [version]);
  return (found.rowCount ?? 0) > 0;
}

async function applyFile(client: Client, dir: string, name: string): Promise<void> {
  const sql = readFileSync(path.join(dir, name), "utf8");
  await client.query("BEGIN");
  try {
    if (sql.trim() !== "") await client.query(sql);
    await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function migrate(databaseUrl: string, dir: string): Promise<MigrateResult> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('app.migrate')::bigint)");
    try {
      await client.query(LEDGER_SQL);
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const name of listMigrations(dir)) {
        if (await recorded(client, name)) {
          skipped.push(name);
          continue;
        }
        await applyFile(client, dir, name);
        applied.push(name);
      }
      return { applied, skipped };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('app.migrate')::bigint)");
    }
  } finally {
    await client.end();
  }
}

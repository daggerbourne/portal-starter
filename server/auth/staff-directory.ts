import { Client } from "pg";
import type { StaffDirectory, StaffRecord, StaffRole } from "./staff-sign-in.js";

type Sql = {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
};

const BIND = "$" + "1";
export function postgresStaffDirectory(deps: {
  readonly databaseUrl: () => string | undefined;
  readonly connect?: (url: string) => Promise<Sql>;
}): StaffDirectory {
  return {
    async findByObjectId(objectId) {
      const url = written(deps.databaseUrl());
      if (url === undefined) return undefined;
      const client = await (deps.connect ?? connectPostgres)(url);
      try {
        const found = await client.query(
          "SELECT role FROM staff WHERE entra_object_id = " + BIND + " AND archived_at IS NULL",
          [objectId],
        );
        const role = staffRole(found.rows[0]);
        if (role === undefined) return undefined;
        const record: StaffRecord = { objectId, role };
        return record;
      } finally {
        await client.end();
      }
    },
  };
}

function staffRole(row: unknown): StaffRole | undefined {
  const record = fields(row);
  if (record === undefined) return undefined;
  if (record.role === "staff" || record.role === "owner") return record.role;
  return undefined;
}

function fields(value: unknown): { readonly [key: string]: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: { [key: string]: unknown } = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function written(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function connectPostgres(url: string): Promise<Sql> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    query(text, values) {
      return client.query(text, [...values]);
    },
    end() {
      return client.end();
    },
  };
}

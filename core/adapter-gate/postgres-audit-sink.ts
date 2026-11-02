import { Client } from "pg";
import type { AuditRow, AuditSink } from "./run-adapter.js";

type Sql = {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
};

const ACTOR = "system:adapter-gate";
const COLUMNS = ["adapter", "mode", "context", "outcome", "occurred_at", "created_by"] as const;
const INSERT =
  "INSERT INTO audit (" +
  COLUMNS.join(", ") +
  ") VALUES (" +
  COLUMNS.map((_, index) => "$" + String(index + 1)).join(", ") +
  ")";

export function createPostgresAuditSink(deps: {
  readonly databaseUrl: () => string | undefined;
  readonly connect?: (url: string) => Promise<Sql>;
}): AuditSink {
  return {
    async write(row: AuditRow) {
      const url = written(deps.databaseUrl());
      if (url === undefined) throw new Error("DATABASE_URL is missing.");
      const client = await (deps.connect ?? connectPostgres)(url);
      try {
        await client.query(INSERT, [row.adapter, row.mode, row.context, row.outcome, row.time, ACTOR]);
      } finally {
        await client.end();
      }
    },
  };
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

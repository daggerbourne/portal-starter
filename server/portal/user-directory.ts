import { Client } from "pg";
import { USER_STATES, type UserState } from "../../contracts/domain.js";
import type { UserDirectory, UserIdentity, UserRecord } from "./user-sign-in.js";

type Sql = {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
};

const COLUMNS = "id, state, display_name, email";
const BY_ID = `SELECT ${COLUMNS} FROM app_user WHERE id::text = $1 AND archived_at IS NULL`;
const BY_IDENTITY = `SELECT ${COLUMNS} FROM app_user WHERE provider = $1 AND subject = $2 AND archived_at IS NULL`;
const CREATE = `INSERT INTO app_user (provider, subject, email, display_name, state, created_by) VALUES ($1, $2, $3, $4, $5::user_state, 'system:portal-sign-in') ON CONFLICT (provider, subject) DO UPDATE SET updated_at = app_user.updated_at RETURNING ${COLUMNS}`;
const SET_STATE = `UPDATE app_user SET state = $2::user_state, updated_at = now() WHERE id::text = $1 AND archived_at IS NULL RETURNING ${COLUMNS}`;

export function postgresUserDirectory(deps: {
  readonly databaseUrl: () => string | undefined;
  readonly connect?: (url: string) => Promise<Sql>;
}): UserDirectory {
  async function one(text: string, values: readonly unknown[]): Promise<UserRecord | undefined> {
    const url = written(deps.databaseUrl());
    if (url === undefined) return undefined;
    const client = await (deps.connect ?? connectPostgres)(url);
    try {
      const found = await client.query(text, values);
      return record(found.rows[0]);
    } finally {
      await client.end();
    }
  }
  async function required(text: string, values: readonly unknown[]): Promise<UserRecord> {
    const found = await one(text, values);
    if (found === undefined) throw new Error("user");
    return found;
  }
  return {
    findById: (id) => one(BY_ID, [id]),
    findByIdentity: (identity: UserIdentity) => one(BY_IDENTITY, [identity.provider, identity.subject]),
    create: (identity, state) =>
      required(CREATE, [identity.provider, identity.subject, identity.email, identity.displayName, state]),
    setState: (id, state) => required(SET_STATE, [id, state]),
  };
}

function record(row: unknown): UserRecord | undefined {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
  const id: unknown = Reflect.get(row, "id");
  const state = userState(Reflect.get(row, "state"));
  const displayName: unknown = Reflect.get(row, "display_name");
  const email: unknown = Reflect.get(row, "email");
  if (typeof id !== "string" || state === undefined || typeof displayName !== "string" || typeof email !== "string") {
    return undefined;
  }
  return { id, state, displayName, email };
}

function userState(value: unknown): UserState | undefined {
  return USER_STATES.find((state) => state === value);
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

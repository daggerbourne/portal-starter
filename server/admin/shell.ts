import { Client } from "pg";
import { SETTINGS_KEYS, USER_STATES, type SettingsKey } from "../../contracts/domain.js";
import { renderDevBanner } from "../../ui/admin/dev-banner.js";
import { renderSettings } from "../../ui/admin/settings-page.js";
import { renderUserPage } from "../../ui/admin/user-page.js";
import { renderUsers, type UserRow } from "../../ui/admin/users-page.js";
import { handleSession, type AuthDeps, type StaffRole } from "../auth/staff-sign-in.js";
import { productionAuthDeps } from "../auth/wire.js";
const BIND = "$" + "1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERS = "/portal-starter/admin/users/";
const USERS_SQL = `SELECT id, display_name, email, state, updated_at FROM app_user WHERE archived_at IS NULL ORDER BY updated_at DESC, id LIMIT 200`;
const USER_SQL = `SELECT display_name, email, provider, state, created_at, suspended_reason FROM app_user WHERE id = ${BIND} AND archived_at IS NULL`;
const SETTINGS_SQL = `SELECT DISTINCT ON (key) key, value FROM settings WHERE archived_at IS NULL ORDER BY key, version DESC`;

export type Sql = {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
};
type Env = { readonly [name: string]: string | undefined };
type SignedIn = { readonly objectId: string; readonly role: StaffRole };
type Page = "users" | "user" | "settings";
type RecordValue = { readonly [key: string]: unknown };

export type AdminReaders = {
  users(db: Sql, staff: SignedIn): Promise<string>;
  user(db: Sql, staff: SignedIn, id: string): Promise<string | undefined>;
  settings(db: Sql, staff: SignedIn): Promise<string>;
};
export type AdminDeps = {
  readonly env: Env;
  readonly clock: () => Date;
  readonly connect: (url: string) => Promise<Sql>;
  readonly session: () => AuthDeps;
  readonly readers: AdminReaders;
};

export function handleUsers(request: Request, deps: AdminDeps): Promise<Response> {
  return guard(request, deps, "users");
}
export function handleUser(request: Request, deps: AdminDeps): Promise<Response> {
  return guard(request, deps, "user");
}
export function handleSettings(request: Request, deps: AdminDeps): Promise<Response> {
  return guard(request, deps, "settings");
}
export function productionAdminDeps(): AdminDeps {
  return {
    env: process.env,
    clock: () => new Date(),
    connect: connectPostgres,
    session: () => productionAuthDeps(),
    readers: { users: readUsers, user: readUser, settings: readSettings },
  };
}

function guard(request: Request, deps: AdminDeps, page: Page): Promise<Response> {
  return handleSession(request, {
    ...deps.session(),
    env: deps.env,
    clock: deps.clock,
    readData: (staff) => load(request, deps, page, staff),
  });
}

async function load(request: Request, deps: AdminDeps, page: Page, staff: SignedIn): Promise<Response> {
  if (page === "settings" && staff.role !== "owner") return forbidden();
  const id = page === "user" ? userId(request.url) : undefined;
  if (page === "user" && id === undefined) return missed(deps.env);
  const url = written(deps.env.DATABASE_URL);
  if (url === undefined) return unavailable(deps.env);
  const db = await deps.connect(url);
  try {
    if (page === "users") return html(deps.env, await deps.readers.users(db, staff), 200);
    if (page === "settings") return html(deps.env, await deps.readers.settings(db, staff), 200);
    if (page === "user") {
      if (id === undefined) return missed(deps.env);
      const body = await deps.readers.user(db, staff, id);
      return body === undefined ? missed(deps.env) : html(deps.env, body, 200);
    }
    const leftover: never = page;
    throw new Error(leftover);
  } finally {
    await db.end();
  }
}

async function readUsers(db: Sql, staff: SignedIn): Promise<string> {
  const found = await db.query(USERS_SQL, []);
  return renderUsers({ role: staff.role, users: found.rows.map((item) => userRow(item)) });
}

async function readUser(db: Sql, staff: SignedIn, id: string): Promise<string | undefined> {
  const found = await db.query(USER_SQL, [id]);
  const record = fields(found.rows[0]);
  if (record === undefined) return undefined;
  const state = oneOf(USER_STATES, record.state);
  const displayName = text(record, "display_name");
  const email = text(record, "email");
  const provider = text(record, "provider");
  const createdAt = instant(record.created_at);
  if (state === undefined || displayName === undefined || email === undefined || provider === undefined || createdAt === undefined) throw new Error("user");
  const reason = record.suspended_reason;
  return renderUserPage({
    role: staff.role,
    displayName,
    email,
    provider,
    state,
    createdAt,
    suspendedReason: typeof reason === "string" ? reason : null,
  });
}

async function readSettings(db: Sql): Promise<string> {
  const found = await db.query(SETTINGS_SQL, []);
  const values = blankSettings();
  const seen = new Set<SettingsKey>();
  for (const item of found.rows) {
    const record = fields(item);
    if (record === undefined) continue;
    const key = oneOf(SETTINGS_KEYS, record.key);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    values[key] = settingText(record.value);
  }
  return renderSettings({ values });
}

function userRow(value: unknown): UserRow {
  const record = fields(value);
  if (record === undefined) throw new Error("user");
  const id = text(record, "id");
  const state = oneOf(USER_STATES, record.state);
  const displayName = text(record, "display_name");
  const email = text(record, "email");
  const updatedAt = instant(record.updated_at);
  if (id === undefined || state === undefined || displayName === undefined || email === undefined || updatedAt === undefined) throw new Error("user");
  return { id, displayName, email, state, updatedAt };
}

function blankSettings(): { [key in SettingsKey]: string } {
  return { display_name: "Not set", support_email: "Not set" };
}

function settingText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "Not set";
  return JSON.stringify(value) ?? "Not set";
}

function instant(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  for (const item of values) if (item === value) return item;
  return undefined;
}

function text(record: RecordValue, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function fields(value: unknown): RecordValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: { [key: string]: unknown } = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function userId(url: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  if (!pathname.startsWith(USERS)) return undefined;
  const rest = pathname.slice(USERS.length).replace(/\/$/, "");
  if (rest === "" || rest.includes("/")) return undefined;
  try {
    const decoded = decodeURIComponent(rest);
    return UUID.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}
function html(env: Env, body: string, status: number): Response {
  const banner = production(env) ? "" : renderDevBanner({ databaseLabel: databaseLabel(env) });
  const document = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Portal Starter</title><link rel="stylesheet" href="/portal-starter/tokens.css"></head><body>${banner}${body}</body></html>`;
  return new Response(document, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
function missed(env: Env): Response {
  return html(env, "<p>Not found</p>", 404);
}
function unavailable(env: Env): Response {
  return html(env, "<p>The database isn't configured.</p>", 503);
}
function forbidden(): Response {
  return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
function production(env: Env): boolean {
  const value = env.APP_DEPLOY_CONTEXT;
  return typeof value === "string" && value.trim() === "production";
}
function databaseLabel(env: Env): string {
  return written(env.APP_DB_LABEL) ?? "database: not set";
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
    query(statement, values) {
      return client.query(statement, [...values]);
    },
    end() {
      return client.end();
    },
  };
}

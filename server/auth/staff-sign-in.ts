import { randomBytes } from "node:crypto";
import { exchangeEntraCode, type TokenTransport } from "../../adapters/entra/exchange-code.js";
import type { AuditSink, EnvReader } from "../../core/adapter-gate/run-adapter.js";
import type { Role } from "../../contracts/domain.js";
import { allowlistedRedirectUri, entraIds } from "./config.js";
import { clearCookie as sealClear, cookieValue, jsonRecord, plainText as text, redirectTo as redirect, sameText as same, sealCookie as seal, unsealCookie as unseal, type Envelope } from "./cookies.js";

export type StaffRole = Extract<Role, "staff" | "owner">;

export type StaffRecord = { readonly objectId: string; readonly role: StaffRole };

export type StaffDirectory = {
  findByObjectId(objectId: string): Promise<StaffRecord | undefined>;
};

export function memoryStaffDirectory(records: readonly StaffRecord[]): StaffDirectory {
  return {
    findByObjectId(objectId) {
      return Promise.resolve(records.find((record) => record.objectId === objectId));
    },
  };
}

const LOGIN_COOKIE = "app_login";
const SESSION_COOKIE = "app_session";
const LOGIN_MS = 10 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const PREVIEW = "sign-in isn't available on previews";
const ENTRA_STAFF_ROLE = "PortalStarter.Staff";

type LoginTicket = { readonly purpose: "login"; readonly state: string; readonly nonce: string; readonly exp: number };
type SessionTicket = {
  readonly purpose: "session";
  readonly objectId: string;
  readonly role: StaffRole | "none";
  readonly exp: number;
};

export type AuthDeps = {
  readonly env: { readonly [name: string]: string | undefined };
  readonly clock: () => Date;
  readonly directory: StaffDirectory;
  readonly audit: AuditSink;
  readonly mockIdToken: (code: string) => string | undefined;
  readonly transport: TokenTransport;
  readonly readData: (staff: { readonly objectId: string; readonly role: StaffRole }) => Promise<Response>;
};

export function handleLogin(request: Request, deps: AuthDeps): Response {
  const redirectUri = allowlistedRedirectUri(request.url);
  if (redirectUri === undefined) return text(200, PREVIEW);
  const key = textEnv(deps.env, "APP_SESSION_KEY");
  if (key === undefined) return text(403, "forbidden");
  const now = deps.clock();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const ids = entraIds(deps.env);
  const url = new URL(`https://login.microsoftonline.com/${ids.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", ids.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  const ticket: LoginTicket = { purpose: "login", state, nonce, exp: now.getTime() + LOGIN_MS };
  return redirect(url.toString(), [seal(LOGIN_COOKIE, ticket, key, now)]);
}

export async function handleCallback(request: Request, deps: AuthDeps): Promise<Response> {
  const redirectUri = allowlistedRedirectUri(request.url);
  if (redirectUri === undefined) return text(200, PREVIEW);
  const key = textEnv(deps.env, "APP_SESSION_KEY");
  if (key === undefined) return text(403, "forbidden");
  const now = deps.clock();
  const url = new URL(request.url);
  const ticket = openTicket(cookieValue(request, LOGIN_COOKIE), key, now);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (ticket === undefined || state === null || code === null || code === "" || !same(ticket.state, state)) {
    return text(403, "forbidden");
  }
  const signedIn = await signedInObject(deps, code, redirectUri, ticket.nonce, now);
  if (signedIn === undefined) return text(403, "forbidden", [sealClear(LOGIN_COOKIE)]);
  const session: SessionTicket = {
    purpose: "session",
    objectId: signedIn.objectId,
    role: signedIn.role,
    exp: now.getTime() + SESSION_MS,
  };
  const cookies = [seal(SESSION_COOKIE, session, key, now), sealClear(LOGIN_COOKIE)];
  if (signedIn.role === "none") return text(403, "forbidden", cookies);
  return redirect("/portal-starter/admin", cookies);
}

export async function handleSession(request: Request, deps: AuthDeps): Promise<Response> {
  const key = textEnv(deps.env, "APP_SESSION_KEY");
  if (key === undefined) return text(403, "forbidden");
  const opened = openSession(cookieValue(request, SESSION_COOKIE), key, deps.clock());
  if (opened === undefined) return text(403, "forbidden");
  return deps.readData(opened);
}

export function handleLogout(): Response {
  return text(200, "signed out", [sealClear(SESSION_COOKIE), sealClear(LOGIN_COOKIE)]);
}

async function signedInObject(
  deps: AuthDeps,
  code: string,
  redirectUri: string,
  nonce: string,
  now: Date,
): Promise<{ readonly objectId: string; readonly role: StaffRole | "none" } | undefined> {
  const ids = entraIds(deps.env);
  const env: EnvReader = (name) => deps.env[name];
  let idToken: string;
  try {
    idToken = await exchangeEntraCode(
      { code, redirectUri },
      {
        gate: { env, clock: deps.clock, audit: deps.audit },
        tenantId: ids.tenantId,
        clientId: ids.clientId,
        clientSecret: textEnv(deps.env, "APP_ENTRA_CLIENT_SECRET"),
        mockIdToken: deps.mockIdToken,
        transport: deps.transport,
      },
    );
  } catch {
    return undefined;
  }
  const claims = claimsOf(idToken);
  if (claims === undefined) return undefined;
  if (claims.iss !== `https://login.microsoftonline.com/${ids.tenantId}/v2.0`) return undefined;
  if (claims.aud !== ids.clientId) return undefined;
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now.getTime()) {
    return undefined;
  }
  if (typeof claims.nonce !== "string" || !same(claims.nonce, nonce)) return undefined;
  if (typeof claims.oid !== "string" || claims.oid === "") return undefined;
  const role = await grantSessionRole(claims.roles, claims.oid, deps.directory);
  return { objectId: claims.oid, role };
}

async function grantSessionRole(
  roles: unknown,
  objectId: string,
  directory: StaffDirectory,
): Promise<StaffRole | "none"> {
  if (!Array.isArray(roles) || !roles.some((role) => role === ENTRA_STAFF_ROLE)) return "none";
  const record = await directory.findByObjectId(objectId);
  const role = record?.role;
  switch (role) {
    case "owner":
      return "owner";
    case "staff":
    case undefined:
      return "staff";
    default: {
      const unreachable: never = role;
      throw new Error(unreachable);
    }
  }
}

function openTicket(value: string | undefined, key: string, now: Date): LoginTicket | undefined {
  const parsed = unseal(value, key, now);
  if (parsed?.purpose !== "login" || typeof parsed.state !== "string" || typeof parsed.nonce !== "string") {
    return undefined;
  }
  return { purpose: "login", state: parsed.state, nonce: parsed.nonce, exp: parsed.exp };
}

function openSession(
  value: string | undefined,
  key: string,
  now: Date,
): { readonly objectId: string; readonly role: StaffRole } | undefined {
  const parsed = unseal(value, key, now);
  if (parsed?.purpose !== "session" || typeof parsed.objectId !== "string") return undefined;
  if (parsed.role !== "staff" && parsed.role !== "owner") return undefined;
  return { objectId: parsed.objectId, role: parsed.role };
}


function claimsOf(idToken: string): Envelope | undefined {
  const body = idToken.split(".")[1];
  if (idToken.split(".").length !== 3 || body === undefined || body === "") return undefined;
  return jsonRecord(Buffer.from(body, "base64url").toString("utf8"));
}

function textEnv(env: AuthDeps["env"], name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

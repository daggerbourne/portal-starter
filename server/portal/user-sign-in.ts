import { portalAllowed, transitionUser, type UserState } from "../../contracts/domain.js";
import { clearCookie, cookieValue, plainText, redirectTo, sealCookie, unsealCookie } from "../auth/cookies.js";

export type UserIdentity = {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
  readonly displayName: string;
};

export type UserSignInProvider = {
  readonly name: string;
  start(request: Request): Promise<Response>;
  finish(request: Request): Promise<UserIdentity | undefined>;
};

export type UserRecord = {
  readonly id: string;
  readonly state: UserState;
  readonly displayName: string;
  readonly email: string;
};

export type UserDirectory = {
  findById(id: string): Promise<UserRecord | undefined>;
  findByIdentity(identity: UserIdentity): Promise<UserRecord | undefined>;
  create(identity: UserIdentity, state: UserState): Promise<UserRecord>;
  setState(id: string, state: UserState): Promise<UserRecord>;
};

export type PortalDeps = {
  readonly env: { readonly [name: string]: string | undefined };
  readonly clock: () => Date;
  readonly provider: UserSignInProvider;
  readonly directory: UserDirectory;
  readonly readData: (user: UserRecord) => Promise<Response>;
};

export const USER_SESSION_COOKIE = "app_user_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const NOT_SET_UP = "User sign-in isn't set up for this app yet.";

export const stubUserProvider: UserSignInProvider = {
  name: "stub",
  start() {
    return Promise.resolve(plainText(501, NOT_SET_UP));
  },
  finish() {
    return Promise.resolve(undefined);
  },
};

export function memoryUserDirectory(seed: readonly (UserRecord & { readonly identity?: UserIdentity })[] = []): UserDirectory {
  const rows = seed.map((row) => ({ ...row }));
  let next = rows.length;
  const key = (identity: UserIdentity): string => `${identity.provider}\u0000${identity.subject}`;
  const plain = (row: UserRecord): UserRecord => ({ id: row.id, state: row.state, displayName: row.displayName, email: row.email });
  return {
    findById(id) {
      const found = rows.find((row) => row.id === id);
      return Promise.resolve(found === undefined ? undefined : plain(found));
    },
    findByIdentity(identity) {
      const found = rows.find((row) => row.identity !== undefined && key(row.identity) === key(identity));
      return Promise.resolve(found === undefined ? undefined : plain(found));
    },
    create(identity, state) {
      next += 1;
      const row = { id: `memory-user-${String(next)}`, state, displayName: identity.displayName, email: identity.email, identity };
      rows.push(row);
      return Promise.resolve(plain(row));
    },
    setState(id, state) {
      const found = rows.find((row) => row.id === id);
      if (found === undefined) return Promise.reject(new Error("user"));
      found.state = state;
      return Promise.resolve(plain(found));
    },
  };
}

export function handleUserLogin(request: Request, deps: PortalDeps): Promise<Response> {
  if (sessionKey(deps.env) === undefined) return Promise.resolve(plainText(403, "forbidden"));
  return deps.provider.start(request);
}

export async function handleUserCallback(request: Request, deps: PortalDeps): Promise<Response> {
  const key = sessionKey(deps.env);
  if (key === undefined) return plainText(403, "forbidden");
  const identity = await deps.provider.finish(request);
  if (identity === undefined || identity.provider !== deps.provider.name || identity.subject === "") {
    return plainText(403, "forbidden");
  }
  const user = await signIn(identity, deps.directory);
  if (user === undefined || !portalAllowed(user.state)) return plainText(403, "forbidden");
  const now = deps.clock();
  const cookie = sealCookie(USER_SESSION_COOKIE, { purpose: "user_session", userId: user.id, exp: now.getTime() + SESSION_MS }, key, now);
  return redirectTo("/portal-starter/portal", [cookie]);
}

export async function handleUserSession(request: Request, deps: PortalDeps): Promise<Response> {
  const key = sessionKey(deps.env);
  if (key === undefined) return plainText(403, "forbidden");
  const opened = unsealCookie(cookieValue(request, USER_SESSION_COOKIE), key, deps.clock());
  if (opened?.purpose !== "user_session" || typeof opened.userId !== "string") return plainText(403, "forbidden");
  const user = await deps.directory.findById(opened.userId);
  if (user === undefined || !portalAllowed(user.state)) return plainText(403, "forbidden", [clearCookie(USER_SESSION_COOKIE)]);
  return deps.readData(user);
}

export function handleUserLogout(): Response {
  return plainText(200, "signed out", [clearCookie(USER_SESSION_COOKIE)]);
}


async function signIn(identity: UserIdentity, directory: UserDirectory): Promise<UserRecord | undefined> {
  const found = await directory.findByIdentity(identity);
  if (found === undefined) return directory.create(identity, "active");
  if (found.state !== "invited") return found;
  const moved = transitionUser(found.state, { type: "activate" });
  return moved.ok ? directory.setState(found.id, moved.state) : undefined;
}

function sessionKey(env: PortalDeps["env"]): string | undefined {
  const value = env.APP_USER_SESSION_KEY;
  if (typeof value !== "string" || value === "") return undefined;
  if (value === env.APP_SESSION_KEY) return undefined;
  return value;
}

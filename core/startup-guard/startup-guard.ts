export const LIVE_KEY_NAMES: readonly string[] = [];

export type StartupEnv = {
  readonly [name: string]: string | undefined;
};

const REFUSAL_BODY = "Portal Starter cannot start in this deploy context.";
const POOLER_SUFFIX = "-pooler";

type ContextKind = "production" | "other" | "missing";

type DatabaseFact =
  | { readonly kind: "missing" }
  | { readonly kind: "unparseable" }
  | { readonly kind: "hosts"; readonly hosts: readonly string[] };

type Facts = {
  readonly context: ContextKind;
  readonly liveKey: boolean;
  readonly prodHost: string | undefined;
  readonly database: DatabaseFact;
};

type Decision = "allow" | "refuse";

export function startupRefusal(
  env: StartupEnv,
  liveKeyNames: readonly string[] = LIVE_KEY_NAMES,
): Response | undefined {
  const decision = decide(factsFrom(env, liveKeyNames));
  switch (decision) {
    case "allow":
      return undefined;
    case "refuse":
      return new Response(REFUSAL_BODY, {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    default: {
      const unexpected: never = decision;
      throw new Error(unexpected);
    }
  }
}

function factsFrom(env: StartupEnv, liveKeyNames: readonly string[]): Facts {
  return {
    context: contextKind(env.APP_DEPLOY_CONTEXT),
    liveKey: liveKeyPresent(env, liveKeyNames),
    prodHost: written(env.APP_PROD_DB_HOST),
    database: databaseFact(env.DATABASE_URL),
  };
}

function decide(facts: Facts): Decision {
  switch (facts.context) {
    case "production":
      return "allow";
    case "missing":
      return "refuse";
    case "other":
      return decideOutsideProduction(facts);
    default: {
      const unexpected: never = facts.context;
      throw new Error(unexpected);
    }
  }
}

function decideOutsideProduction(facts: Facts): Decision {
  if (facts.liveKey) return "refuse";
  const prodHost = facts.prodHost;
  if (prodHost === undefined) return "refuse";
  switch (facts.database.kind) {
    case "missing":
      return "allow";
    case "unparseable":
      return "refuse";
    case "hosts":
      return facts.database.hosts.some((host) => sameDatabaseHost(host, prodHost)) ? "refuse" : "allow";
    default: {
      const unexpected: never = facts.database;
      throw new Error(unexpected);
    }
  }
}

function contextKind(value: unknown): ContextKind {
  const text = written(value);
  if (text === undefined) return "missing";
  if (text === "production") return "production";
  return "other";
}

function liveKeyPresent(env: StartupEnv, names: readonly string[]): boolean {
  if (written(env.MODE) === "live") return true;
  for (const name of names) {
    if (written(env[name]) !== undefined) return true;
  }
  return false;
}

function databaseFact(value: unknown): DatabaseFact {
  const text = written(value);
  if (text === undefined) return { kind: "missing" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "unparseable" };
  }
  const host = hostPgUses(url);
  if (host === undefined) return { kind: "unparseable" };
  return { kind: "hosts", hosts: hostsToMatch(host) };
}

function hostPgUses(url: URL): string | undefined {
  let queryHost: string | undefined;
  for (const [key, value] of url.searchParams) {
    if (key === "host") queryHost = value;
  }
  if (queryHost) return queryHost;
  if (url.hostname === "") return undefined;
  return url.hostname;
}

function hostsToMatch(host: string): readonly string[] {
  if (isSocketPath(host)) return [host];
  return host.split(",");
}

function isSocketPath(host: string): boolean {
  return host.startsWith("/");
}

function sameDatabaseHost(databaseHost: string, prodHost: string): boolean {
  return canonicalHost(databaseHost) === canonicalHost(prodHost);
}

function canonicalHost(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/, "");
  const dot = normalized.indexOf(".");
  const label = dot === -1 ? normalized : normalized.slice(0, dot);
  const rest = dot === -1 ? "" : normalized.slice(dot);
  const endpoint = label.endsWith(POOLER_SUFFIX) ? label.slice(0, -POOLER_SUFFIX.length) : label;
  return `${endpoint}${rest}`;
}

function written(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

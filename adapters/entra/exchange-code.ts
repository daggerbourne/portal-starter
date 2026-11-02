import { runAdapter, type AdapterDeps, type Mode } from "../../core/adapter-gate/run-adapter.js";

export type TokenTransport = (request: {
  readonly url: string;
  readonly body: string;
}) => Promise<{ readonly status: number; readonly body: string }>;

export type EntraExchangeDeps = {
  readonly gate: AdapterDeps;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly mockIdToken: (code: string) => string | undefined;
  readonly transport: TokenTransport;
};

export function exchangeEntraCode(
  input: { readonly code: string; readonly redirectUri: string },
  deps: EntraExchangeDeps,
): Promise<string> {
  return runAdapter("entra", (mode) => tokenFor(mode, input, deps), deps.gate);
}

async function tokenFor(
  mode: Mode,
  input: { readonly code: string; readonly redirectUri: string },
  deps: EntraExchangeDeps,
): Promise<string> {
  switch (mode) {
    case "mock": {
      const idToken = deps.mockIdToken(input.code);
      if (idToken === undefined) throw new Error("Mock Entra has no token.");
      return idToken;
    }
    case "sandbox":
    case "live":
      return requestedToken(input, deps);
    default: {
      const unreachable: never = mode;
      throw new Error(unreachable);
    }
  }
}

function failToken(status: number | "none", body: string, redirectUri: string, secret: string, message: string): never {
  const clean = (value: string): string => (secret === "" ? value : value.split(secret).join(""));
  let host = "";
  try { host = new URL(redirectUri).host; } catch { host = ""; }
  let error = "", aadsts = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const code = Reflect.get(parsed, "error");
      const description = Reflect.get(parsed, "error_description");
      if (typeof code === "string") error = clean(code).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
      if (typeof description === "string") aadsts = /AADSTS\d+/.exec(clean(description))?.[0] ?? "";
    }
  } catch { error = ""; }
  const shown = [`status ${status}`, `host ${clean(host)}`, `error ${error}`].join(" ").trimEnd();
  process.stderr.write(`entra token ${shown}${aadsts === "" ? "" : ` ${aadsts}`}\n`);
  throw new Error(message);
}

async function requestedToken(
  input: { readonly code: string; readonly redirectUri: string },
  deps: EntraExchangeDeps,
): Promise<string> {
  const secret = deps.clientSecret;
  if (secret === undefined || secret === "") failToken("none", "{\"error\":\"missing_client\"}", input.redirectUri, "", "Entra client secret is missing.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: deps.clientId,
    client_secret: secret,
    code: input.code,
    redirect_uri: input.redirectUri,
    scope: "openid profile email",
  });
  const response = await deps.transport({
    url: `https://login.microsoftonline.com/${deps.tenantId}/oauth2/v2.0/token`,
    body: body.toString(),
  });
  if (response.status !== 200) failToken(response.status, response.body, input.redirectUri, secret, "Entra token endpoint refused the code.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error("Entra token response is not JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || !("id_token" in parsed)) {
    throw new Error("Entra token response has no id token.");
  }
  if (typeof parsed.id_token !== "string" || parsed.id_token === "") {
    throw new Error("Entra token response has no id token.");
  }
  return parsed.id_token;
}

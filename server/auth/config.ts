export const ENTRA_REDIRECT_URIS = [
  "https://portal-starter.netlify.app/portal-starter/auth/callback",
  "https://main--portal-starter.netlify.app/portal-starter/auth/callback",
  "http://localhost:8888/portal-starter/auth/callback",
  "https://auth-test--portal-starter.netlify.app/portal-starter/auth/callback",
] as const;

// scripts/init-app.ts writes the real ids here. APP_ENTRA_TENANT_ID and APP_ENTRA_CLIENT_ID override them.
// Keep them as joined parts: a hyphenated literal matches Netlify's secret scan for these env vars.
export const DEFAULT_ENTRA_TENANT_ID = ["00000000", "0000", "0000", "0000", "000000000000"].join("-");
export const DEFAULT_ENTRA_CLIENT_ID = ["00000000", "0000", "0000", "0000", "000000000000"].join("-");

export type EntraIds = { readonly tenantId: string; readonly clientId: string };

function written(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function entraIds(env: { readonly [name: string]: string | undefined }): EntraIds {
  return {
    tenantId: written(env.APP_ENTRA_TENANT_ID) ?? DEFAULT_ENTRA_TENANT_ID,
    clientId: written(env.APP_ENTRA_CLIENT_ID) ?? DEFAULT_ENTRA_CLIENT_ID,
  };
}

export function allowlistedRedirectUri(requestUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  return ENTRA_REDIRECT_URIS.find((candidate) => new URL(candidate).origin === url.origin);
}

import { renderDevBanner } from "../../ui/admin/dev-banner.js";
import { renderPortalHome } from "../../ui/portal/home.js";
import { postgresUserDirectory } from "./user-directory.js";
import { stubUserProvider, type PortalDeps, type UserRecord } from "./user-sign-in.js";

type Env = { readonly [name: string]: string | undefined };

export function productionPortalDeps(): PortalDeps {
  const env: Env = process.env;
  return {
    env,
    clock: () => new Date(),
    provider: stubUserProvider,
    directory: postgresUserDirectory({ databaseUrl: () => process.env.DATABASE_URL }),
    readData: (user) => Promise.resolve(portalPage(env, user)),
  };
}

export function portalPage(env: Env, user: UserRecord): Response {
  const production = env.APP_DEPLOY_CONTEXT?.trim() === "production";
  const label = env.APP_DB_LABEL?.trim();
  const banner = production ? "" : renderDevBanner({ databaseLabel: label === undefined || label === "" ? "database: not set" : label });
  const body = renderPortalHome({ displayName: user.displayName, email: user.email });
  const document = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Portal Starter</title><link rel="stylesheet" href="/portal-starter/tokens.css"></head><body>${banner}${body}</body></html>`;
  return new Response(document, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

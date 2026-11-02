import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleUserSession } from "../portal/user-sign-in.js";
import { productionPortalDeps } from "../portal/wire.js";

export const config = { path: "/portal-starter/portal" };

export default function portalHome(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleUserSession(request, productionPortalDeps());
}

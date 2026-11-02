import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleUserLogin } from "../portal/user-sign-in.js";
import { productionPortalDeps } from "../portal/wire.js";

export const config = { path: "/portal-starter/portal/auth/login" };

export default function portalLogin(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleUserLogin(request, productionPortalDeps());
}

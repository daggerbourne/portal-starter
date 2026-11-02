import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleCallback } from "../auth/staff-sign-in.js";
import { productionAuthDeps } from "../auth/wire.js";

export const config = { path: "/portal-starter/auth/callback" };

export default function authCallback(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleCallback(request, productionAuthDeps());
}

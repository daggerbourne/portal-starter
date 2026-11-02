import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleSession } from "../auth/staff-sign-in.js";
import { productionAuthDeps } from "../auth/wire.js";

export const config = { path: "/portal-starter/auth/session" };

export default function authSession(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleSession(request, productionAuthDeps());
}

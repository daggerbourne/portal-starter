import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleLogin } from "../auth/staff-sign-in.js";
import { productionAuthDeps } from "../auth/wire.js";

export const config = { path: "/portal-starter/auth/login" };

export default function authLogin(request: Request): Response {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return refused;
  return handleLogin(request, productionAuthDeps());
}

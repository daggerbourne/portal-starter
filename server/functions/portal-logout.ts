import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleUserLogout } from "../portal/user-sign-in.js";

export const config = { path: "/portal-starter/portal/auth/logout" };

export default function portalLogout(): Response {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return refused;
  return handleUserLogout();
}

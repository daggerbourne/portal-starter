import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleLogout } from "../auth/staff-sign-in.js";

export const config = { path: "/portal-starter/auth/logout" };

export default function authLogout(): Response {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return refused;
  return handleLogout();
}

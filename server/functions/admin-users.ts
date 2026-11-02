import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleUsers, productionAdminDeps } from "../admin/shell.js";

export const config = { path: "/portal-starter/admin" };

export default function adminUsers(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleUsers(request, productionAdminDeps());
}

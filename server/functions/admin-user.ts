import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleUser, productionAdminDeps } from "../admin/shell.js";

export const config = { path: "/portal-starter/admin/users/:id" };

export default function adminUser(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleUser(request, productionAdminDeps());
}

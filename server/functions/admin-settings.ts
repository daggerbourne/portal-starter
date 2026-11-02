import { startupRefusal } from "../../core/startup-guard/startup-guard.js";
import { handleSettings, productionAdminDeps } from "../admin/shell.js";

export const config = { path: "/portal-starter/admin/settings" };

export default function adminSettings(request: Request): Promise<Response> {
  const refused = startupRefusal(process.env);
  if (refused !== undefined) return Promise.resolve(refused);
  return handleSettings(request, productionAdminDeps());
}

import { entraTokenTransport } from "../../adapters/entra/token-transport.js";
import { createPostgresAuditSink } from "../../core/adapter-gate/postgres-audit-sink.js";
import type { AuditSink } from "../../core/adapter-gate/run-adapter.js";
import { postgresStaffDirectory } from "./staff-directory.js";
import type { AuthDeps } from "./staff-sign-in.js";

export function productionAuthDeps(input?: { readonly audit?: AuditSink }): AuthDeps {
  const databaseUrl = (): string | undefined => process.env.DATABASE_URL;
  return {
    env: process.env,
    clock: () => new Date(),
    directory: postgresStaffDirectory({ databaseUrl }),
    audit: input?.audit ?? createPostgresAuditSink({ databaseUrl }),
    mockIdToken: () => undefined,
    transport: entraTokenTransport,
    readData: (staff) => Promise.resolve(Response.json({ role: staff.role })),
  };
}

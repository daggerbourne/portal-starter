import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../db/migrate.js";

function requiredDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    process.stderr.write("DATABASE_URL is required\n");
    process.exit(1);
  }
  return databaseUrl;
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db");

try {
  const result = await migrate(requiredDatabaseUrl(), dir);
  if (result.applied.length > 0) process.stdout.write(`${result.applied.join("\n")}\n`);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "migrate failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

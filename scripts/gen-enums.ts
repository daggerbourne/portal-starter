import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATABASE_ENUMS } from "../contracts/domain.js";

const LABEL = /^[a-z0-9_]+$/;

export function renderEnumsSql(): string {
  const blocks = Object.entries(DATABASE_ENUMS).map(([name, values]) => {
    const labels = values.map((value) => {
      if (!LABEL.test(name) || !LABEL.test(value)) throw new Error("enum label");
      return `'${value}'`;
    });
    return [
      "DO $$ BEGIN",
      `  CREATE TYPE ${name} AS ENUM (${labels.join(", ")});`,
      "EXCEPTION WHEN duplicate_object THEN NULL;",
      "END $$;",
    ].join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}

const scriptPath = fileURLToPath(import.meta.url);
const invoked = process.argv[1];
if (invoked !== undefined && path.resolve(invoked) === scriptPath) {
  const target = path.join(path.dirname(scriptPath), "../contracts/generated/enums.sql");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, renderEnumsSql());
}

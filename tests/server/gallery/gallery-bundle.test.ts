import assert from "node:assert/strict";
import { globSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the gallery bundle includes contracts/domain.ts", async () => {
  const imported: unknown = await import("../../../server/functions/gallery/index.mjs");
  const patterns = includedPatterns(imported);
  const functionDir = path.dirname(
    fileURLToPath(new URL("../../../server/functions/gallery/index.mjs", import.meta.url)),
  );
  const repoRoot = path.resolve(functionDir, "../../..");
  const bundled = patterns.flatMap((pattern) => globSync(pattern, { cwd: functionDir }));
  const relative = bundled.map((file) =>
    path.relative(repoRoot, path.resolve(functionDir, file)).split(path.sep).join("/"),
  );
  assert.equal(relative.includes("contracts/domain.ts"), true);
});

function includedPatterns(value: unknown): readonly string[] {
  if (
    typeof value === "object" &&
    value !== null &&
    "config" in value &&
    typeof value.config === "object" &&
    value.config !== null &&
    "includedFiles" in value.config &&
    Array.isArray(value.config.includedFiles) &&
    value.config.includedFiles.every((entry): entry is string => typeof entry === "string")
  ) {
    return value.config.includedFiles;
  }
  throw new Error("gallery includedFiles is not a list of paths");
}

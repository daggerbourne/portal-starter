import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const parent = context.parentURL;
    if (!specifier.endsWith(".js") || parent === undefined || !parent.startsWith("file:")) {
      throw error;
    }
    const candidate = path.resolve(path.dirname(fileURLToPath(parent)), `${specifier.slice(0, -3)}.ts`);
    if (!existsSync(candidate)) throw error;
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
  const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip" });
  return { format: "module", source, shortCircuit: true };
}

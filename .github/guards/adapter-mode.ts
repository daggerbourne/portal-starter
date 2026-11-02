import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = "0".repeat(40);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "dist.build", ".git"]);
const UNSCANNED = ["tests/config/guards/adapter-mode/fixtures/", ".github/", ".cursor/"];
const ALLOWED_PREFIXES = ["adapters/", "core/adapter-gate/"];
const PG_PREFIXES = ["db/", "scripts/", "server/", "tests/"];
const NETWORK_PACKAGES = new Set([
  "http", "https", "net", "tls", "http2", "undici", "axios", "node-fetch", "got", "pg",
]);
const REGEX_KEYWORDS = new Set(["return", "throw", "case", "void", "typeof", "delete", "await", "yield", "else", "do", "in", "of", "instanceof", "new"]);
const CI_WORKFLOW = ".github/workflows/ci.yml";
const MISSING_MODE = `${CI_WORKFLOW}: ci job is missing MODE=mock`;
const UNREADABLE_MODE = `${CI_WORKFLOW}: unreadable workflow`;

export type ChangeList =
  | { readonly kind: "paths"; readonly paths: readonly string[] }
  | { readonly kind: "unknown" };
export type GuardDepth = "markdown-only" | "full";
export type GuardJudgment =
  | { readonly ok: true }
  | { readonly ok: false; readonly messages: readonly string[] };
type Finding = { readonly line: number; readonly call: string };
type SpecifierKind = "import" | "import()" | "require" | "require.resolve";

export function guardDepth(changes: ChangeList): GuardDepth {
  switch (changes.kind) {
    case "paths":
      return changes.paths.length > 0 && changes.paths.every((file) => file.endsWith(".md")) ? "markdown-only" : "full";
    case "unknown":
      return "full";
    default: {
      const unexpected: never = changes;
      throw new Error(`unexpected changes ${JSON.stringify(unexpected)}`);
    }
  }
}
export function changesFromEnv(env: NodeJS.ProcessEnv, cwd = process.cwd()): ChangeList {
  switch (env.EVENT_NAME) {
    case "pull_request":
      return diffRange(env.PR_BASE, env.HEAD_SHA, cwd);
    case "push":
      return env.EVENT_BEFORE === ZERO_SHA ? { kind: "unknown" } : diffRange(env.EVENT_BEFORE, env.HEAD_SHA, cwd);
    default:
      return { kind: "unknown" };
  }
}
export function judgeRepository(root: string): GuardJudgment {
  const messages = [...ciModeMessages(root), ...scanRoot(root)];
  if (messages.length === 0) return { ok: true };
  return { ok: false, messages };
}
function ciModeMessages(root: string): readonly string[] {
  let source: string;
  try {
    source = readFileSync(path.join(root, CI_WORKFLOW), "utf8");
  } catch {
    return [MISSING_MODE];
  }
  const judgment = judgeCiMode(source);
  if (judgment === "mock") return [];
  return [judgment === "unreadable" ? UNREADABLE_MODE : MISSING_MODE];
}
function judgeCiMode(source: string): "mock" | "missing" | "unreadable" {
  if (source.includes("\t") || /(^|\n)\s*<<:/.test(source) || /(^|\n)[^\n]*\s[&*][A-Za-z_]/.test(source)) return "unreadable";
  const modes: string[] = [];
  const stack: { indent: number; key: string }[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const body = line.slice(indent);
    if (body === "-" || body.startsWith("- ")) continue;
    const parsed = body.match(/^(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^:#\s][^:#]*?))\s*:\s*(.*)$/);
    if (parsed === null) return "unreadable";
    const key = (parsed[1] ?? parsed[2] ?? parsed[3] ?? "").trim();
    const rest = parsed[4] ?? "";
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack.push({ indent, key });
    const keys = stack.map((item) => item.key);
    if (key === "env" && keys.at(-3) === "jobs" && keys.at(-2) === "ci") {
      const flow = rest.trim().match(/^\{(.*)\}\s*(?:#.*)?$/);
      if (flow?.[1] !== undefined) {
        const value = flowMode(flow[1]);
        if (value === "unreadable") return "unreadable";
        if (value !== undefined) modes.push(value);
      }
    }
    if (key === "MODE" && keys.at(-4) === "jobs" && keys.at(-3) === "ci" && keys.at(-2) === "env") {
      const value = scalar(rest);
      if (value === "unreadable") return "unreadable";
      modes.push(value);
    }
  }
  return modes.length > 0 && modes.every((mode) => mode === "mock") ? "mock" : "missing";
}
function flowMode(body: string): string | undefined | "unreadable" {
  const match = body.match(/(?:^|,)\s*(?:"MODE"|'MODE'|MODE)\s*:\s*("[^"]*"|'[^']*'|[^,]+)/);
  return match?.[1] === undefined ? undefined : scalar(match[1].trim());
}
function scalar(rest: string): string | "unreadable" {
  const value = rest.trim();
  if (value.startsWith("|") || value.startsWith(">")) return "unreadable";
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const match = value.match(quote === '"' ? /^"((?:\\.|[^"])*)"/ : /^'((?:\\.|[^'])*)'/);
    return match?.[1] ?? "unreadable";
  }
  const comment = value.search(/\s+#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

function scanRoot(root: string): string[] {
  const messages: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (UNSCANNED.some((prefix) => relative.startsWith(prefix)) || !SOURCE_EXT.has(path.extname(entry.name))) continue;
      messages.push(...scanSource(relative, readFileSync(full, "utf8")));
    }
  };
  walk(root);
  messages.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return messages;
}

function scanSource(file: string, text: string): string[] {
  if (ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) return [];
  const masked = codeMask(text);
  const findings: Finding[] = [];
  const fetchCall = /\bfetch\s*(?:\?\.\s*)?\(/g;
  for (let match = fetchCall.exec(masked); match !== null; match = fetchCall.exec(masked)) {
    const before = masked.slice(0, match.index);
    if (!/\bfunction\s*\*?\s*$/.test(before)) findings.push({ line: lineAt(text, match.index), call: "fetch" });
  }
  collectSpecifiers(file, text, masked, findings);
  collectNonLiteralCalls(text, masked, findings);
  collectBuiltinModules(text, masked, findings);
  collectCreateRequire(text, masked, findings);
  collectFetchReferences(text, masked, findings);
  collectBracketFetch(text, masked, findings);
  findings.sort((left, right) => left.line - right.line || left.call.localeCompare(right.call));
  return findings.map((finding) => `${file}:${finding.line}: ${finding.call}`);
}
function collectSpecifiers(file: string, text: string, masked: string, findings: Finding[]): void {
  let index = 0;
  while (index < text.length) {
    const ch = text[index] ?? "";
    if (ch === "`" && masked[index] === "`") {
      const kind = specifierKind(text, index);
      const template = readTemplate(text, index);
      if (kind !== null && template !== null) {
        const call = template.dynamic
          ? `${kind} non-literal`
          : specifierCall(file, kind, template.text, continuesString(text, template.end));
        if (call !== null) findings.push({ line: lineAt(text, index), call });
      }
      index = template === null ? index + 1 : template.end;
      continue;
    }
    if ((ch !== "'" && ch !== '"') || masked[index] !== ch) {
      index += 1;
      continue;
    }
    const kind = specifierKind(text, index);
    const value = readQuoted(text, index);
    if (kind !== null && value !== null) {
      const call = specifierCall(file, kind, value.text, continuesString(text, value.end));
      if (call !== null) findings.push({ line: lineAt(text, index), call });
    }
    index = value === null ? index + 1 : value.end;
  }
}
function specifierCall(file: string, kind: SpecifierKind, specifier: string, concatenated: boolean): string | null {
  if (concatenated) return `${kind} non-literal`;
  const network = networkPackage(specifier);
  if (network === null) return null;
  if (network === "pg" && PG_PREFIXES.some((prefix) => file.startsWith(prefix))) return null;
  return `${kind} ${specifier}`;
}
function networkPackage(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes("://")) return null;
  const body = specifier.length >= 5 && specifier.slice(0, 5).toLowerCase() === "node:" ? specifier.slice(5) : specifier;
  if (body === "" || body.startsWith(".") || body.startsWith("/")) return null;
  const slash = body.indexOf("/");
  const name = (slash === -1 ? body : body.slice(0, slash)).toLowerCase();
  return NETWORK_PACKAGES.has(name) ? name : null;
}
function continuesString(text: string, index: number): boolean {
  return text[skipSpace(text, index)] === "+";
}
function skipSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}
function specifierKind(text: string, quoteAt: number): SpecifierKind | null {
  let cursor = quoteAt;
  while (cursor > 0 && /\s/.test(text[cursor - 1] ?? "")) cursor -= 1;
  const raw = text.slice(Math.max(0, cursor - 32), cursor);
  const tail = raw.replace(/\s+/g, "");
  if (tail.endsWith("require.resolve(")) return "require.resolve";
  if (tail.endsWith("require(")) return "require";
  if (tail.endsWith("import(")) return "import()";
  if (/(?:^|\W)from\s*$/.test(raw) || /(?:^|\W)import\s*$/.test(raw)) return "import";
  return null;
}
function readQuoted(text: string, start: number): { readonly text: string; readonly end: number } | null {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index] ?? "";
    if (ch === "\\") {
      value += text[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (ch === quote) return { text: value, end: index + 1 };
    value += ch;
    index += 1;
  }
  return null;
}
function readTemplate(text: string, start: number): { readonly text: string; readonly dynamic: boolean; readonly end: number } | null {
  if (text[start] !== "`") return null;
  let value = "";
  let index = start + 1;
  let dynamic = false;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (index < text.length) {
    const ch = text[index] ?? "";
    if (quote !== null) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (depth > 0) {
      const nested = quoteOf(ch);
      if (nested !== null) {
        quote = nested;
        index += 1;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      index += 1;
      continue;
    }
    if (ch === "\\") {
      value += text[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (ch === "`") return { text: value, dynamic, end: index + 1 };
    if (ch === "$" && text[index + 1] === "{") {
      dynamic = true;
      depth = 1;
      index += 2;
      continue;
    }
    value += ch;
    index += 1;
  }
  return null;
}
function quoteOf(ch: string): "'" | '"' | "`" | null {
  if (ch === "'" || ch === '"' || ch === "`") return ch;
  return null;
}
function collectNonLiteralCalls(text: string, masked: string, findings: Finding[]): void {
  const pattern = /\brequire(?:\.resolve)?\s*\(|\bimport\s*\(/g;
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    const open = match.index + match[0].length - 1;
    const opener = text[skipSpace(text, open + 1)] ?? "";
    if (opener === "'" || opener === '"' || opener === "`") continue;
    const kind = openCallKind(match[0]);
    if (kind === "import()" && opaqueImport(text, open)) continue;
    findings.push({ line: lineAt(text, match.index), call: `${kind} non-literal` });
  }
}
function openCallKind(match: string): SpecifierKind {
  if (match.startsWith("require.resolve")) return "require.resolve";
  if (match.startsWith("require")) return "require";
  return "import()";
}
function opaqueImport(text: string, open: number): boolean {
  const close = balancedEnd(text, open);
  if (close === null) return false;
  const argument = text.slice(open + 1, close);
  if (argument.includes("+") || argument.includes("'") || argument.includes('"') || argument.includes("`")) return false;
  return argument.includes("(");
}
function balancedEnd(text: string, open: number): number | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = open; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if (quote !== null) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    const next = quoteOf(ch);
    if (next !== null) {
      quote = next;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}
function collectBuiltinModules(text: string, masked: string, findings: Finding[]): void {
  const pattern = /\bgetBuiltinModule\s*\(/g;
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    const call = builtinCall(text, match.index + match[0].length - 1);
    if (call !== null) findings.push({ line: lineAt(text, match.index), call });
  }
}
function builtinCall(text: string, open: number): string | null {
  const cursor = skipSpace(text, open + 1);
  const opener = text[cursor] ?? "";
  if (opener === "'" || opener === '"') {
    const value = readQuoted(text, cursor);
    if (value === null || continuesString(text, value.end)) return "getBuiltinModule non-literal";
    return networkPackage(value.text) === null ? null : `getBuiltinModule ${value.text}`;
  }
  if (opener === "`") {
    const template = readTemplate(text, cursor);
    if (template === null || template.dynamic || continuesString(text, template.end)) return "getBuiltinModule non-literal";
    return networkPackage(template.text) === null ? null : `getBuiltinModule ${template.text}`;
  }
  return "getBuiltinModule non-literal";
}
function collectCreateRequire(text: string, masked: string, findings: Finding[]): void {
  const pattern = /\bcreateRequire\s*\(/g;
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    findings.push({ line: lineAt(text, match.index), call: "createRequire" });
  }
}
function collectFetchReferences(text: string, masked: string, findings: Finding[]): void {
  const pattern = /\bfetch\b/g;
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    const index = match.index;
    const previous = masked[index - 1] ?? "";
    const next = masked[index + match[0].length] ?? "";
    if (previous === "-" || next === "-") continue;
    if (/^fetch\s*(?:\?\.\s*)?\(/.test(masked.slice(index))) continue;
    if (/\bfunction\s*\*?\s*$/.test(masked.slice(0, index))) continue;
    findings.push({ line: lineAt(text, index), call: "fetch" });
  }
}
function collectBracketFetch(text: string, masked: string, findings: Finding[]): void {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "[" || masked[index] !== "[") continue;
    const cursor = skipSpace(text, index + 1);
    const opener = text[cursor] ?? "";
    if (opener === "`") {
      const template = readTemplate(text, cursor);
      if (template !== null && !template.dynamic && template.text === "fetch" && closesBracket(text, masked, template.end)) {
        findings.push({ line: lineAt(text, cursor), call: "fetch" });
      }
      continue;
    }
    if (opener !== "'" && opener !== '"') continue;
    const value = readQuoted(text, cursor);
    if (value !== null && value.text === "fetch" && closesBracket(text, masked, value.end)) {
      findings.push({ line: lineAt(text, cursor), call: "fetch" });
    }
  }
}
function closesBracket(text: string, masked: string, end: number): boolean {
  const cursor = skipSpace(text, end);
  return text[cursor] === "]" && masked[cursor] === "]";
}

function codeMask(text: string): string {
  let index = 0;
  let previous: "expr" | "punct" = "punct";
  let depth = 0;
  let out = "";
  const exprClose: number[] = [];
  const frames: Array<"code" | "template"> = ["code"];
  const take = (count: number, keep: boolean): void => {
    const chunk = text.slice(index, index + count);
    out += keep ? chunk : chunk.replace(/[^\n]/g, " ");
    index += count;
  };
  while (index < text.length) {
    if (frames[frames.length - 1] === "template") {
      if (text[index] === "\\") {
        take(Math.min(2, text.length - index), false);
        continue;
      }
      if (text[index] === "`") {
        frames.pop();
        previous = "expr";
        take(1, true);
        continue;
      }
      if (text.startsWith("${", index)) {
        take(2, true);
        depth += 1;
        exprClose.push(depth);
        frames.push("code");
        previous = "punct";
        continue;
      }
      take(1, false);
      continue;
    }
    const ch = text[index] ?? "";
    if (ch === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      take(end === -1 ? text.length - index : end - index, false);
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      take(end === -1 ? text.length - index : end + 2 - index, false);
      continue;
    }
    if (ch === "/" && previous === "punct") {
      let klass = false;
      take(1, false);
      while (index < text.length && text[index] !== "\n") {
        if (text[index] === "\\") {
          take(Math.min(2, text.length - index), false);
          continue;
        }
        if (text[index] === "[") {
          klass = true;
          take(1, false);
        } else if (text[index] === "]") {
          klass = false;
          take(1, false);
        } else if (text[index] === "/" && !klass) {
          take(1, false);
          while (/[a-z]/i.test(text[index] ?? "")) take(1, false);
          break;
        } else take(1, false);
      }
      previous = "expr";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quoted = readQuoted(text, index);
      take(quoted === null ? 1 : quoted.end - index, specifierKind(text, index) !== null);
      previous = "expr";
      continue;
    }
    if (ch === "`") {
      frames.push("template");
      take(1, true);
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = index;
      index += 1;
      while (index < text.length && /[A-Za-z0-9_$]/.test(text[index] ?? "")) index += 1;
      const word = text.slice(start, index);
      out += word;
      previous = REGEX_KEYWORDS.has(word) ? "punct" : "expr";
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      const start = index;
      while (index < text.length && /[0-9A-Za-z_.]/.test(text[index] ?? "")) index += 1;
      out += text.slice(start, index);
      previous = "expr";
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "}") {
      if (exprClose[exprClose.length - 1] === depth) {
        exprClose.pop();
        frames.pop();
      }
      depth = Math.max(0, depth - 1);
      previous = "expr";
      take(1, true);
      continue;
    }
    previous = ch === ")" || ch === "]" ? "expr" : "punct";
    take(1, true);
  }
  return out;
}
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text[cursor] === "\n") line += 1;
  return line;
}

function diffRange(from: string | undefined, to: string | undefined, cwd: string): ChangeList {
  if (from === undefined || to === undefined || !SHA.test(from) || !SHA.test(to)) return { kind: "unknown" };
  const result = spawnSync("git", ["diff", "-z", "--name-only", "--no-renames", from, to], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return { kind: "unknown" };
  const parts = result.stdout.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return { kind: "paths", paths: parts };
}

function runPlan(): number {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) return 1;
  appendFileSync(outputPath, `depth=${guardDepth(changesFromEnv(process.env))}\n`);
  return 0;
}
function runCheck(rootArg: string | undefined): number {
  const judgment = judgeRepository(rootArg ?? process.cwd());
  if (judgment.ok) return 0;
  process.stderr.write(`${judgment.messages.join("\n")}\n`);
  return 1;
}
function run(argv: readonly string[]): number {
  const command = argv[2] ?? "check";
  switch (command) {
    case "plan":
      return runPlan();
    case "check":
      return runCheck(argv[3]);
    default:
      process.stderr.write("unknown command\n");
      return 1;
  }
}
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}
if (isDirectRun()) {
  try {
    process.exit(run(process.argv));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "guard failed"}\n`);
    process.exit(1);
  }
}

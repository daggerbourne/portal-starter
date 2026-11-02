import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type TextFile = { readonly path: string; readonly text: string };
export type ContentFinding = { readonly path: string; readonly line: number; readonly excerpt: string };
export type ContentPlan =
  | { readonly scan: false; readonly output: "scan=false\n" }
  | { readonly scan: true; readonly output: "scan=true\n" };
export type PathChange =
  | { readonly kind: "present"; readonly path: string }
  | { readonly kind: "deleted"; readonly path: string };
export type DiffList =
  | { readonly kind: "unreadable" }
  | { readonly kind: "entries"; readonly entries: readonly PathChange[] };
export type DiffProcess = { readonly status: number | null; readonly stdout: string | undefined };
const SHA = /^[0-9a-f]{40}$/;
const BANNED_WORDS_FILE = "program/banned-words.txt";
const WORD = /^[a-z][a-z0-9 -]*$/;
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const KEYWORDS = new Set("await break case catch class const continue debugger default delete do else enum export extends finally for function if implements import in instanceof interface let new of package private protected public return static switch throw try typeof var void while with yield".split(" "));
type Command = "plan" | "copy";
type TemplateSlot =
  | { readonly kind: "text"; readonly text: string; readonly line: number }
  | { readonly kind: "hole"; readonly pieces: readonly Piece[] };
type Piece =
  | { readonly kind: "string"; readonly text: string; readonly line: number }
  | { readonly kind: "identifier"; readonly text: string; readonly line: number }
  | { readonly kind: "template"; readonly slots: readonly TemplateSlot[]; readonly interpolations: number };
type Lexed = { readonly pieces: readonly Piece[]; readonly index: number; readonly line: number };
type CopyTarget =
  | { readonly kind: "raw" }
  | { readonly kind: "code" }
  | { readonly kind: "skip" };
function fail(value: never): never {
  throw new Error(`unexpected ${JSON.stringify(value)}`);
}
export function planContentScan(paths: readonly string[]): ContentPlan {
  if (paths.length > 0 && paths.every((filePath) => filePath.endsWith(".md"))) {
    return { scan: false, output: "scan=false\n" };
  }
  return { scan: true, output: "scan=true\n" };
}
export function pathsToRead(changes: readonly PathChange[]): readonly string[] {
  const paths: string[] = [];
  for (const change of changes) {
    switch (change.kind) {
      case "present":
        paths.push(change.path);
        break;
      case "deleted":
        break;
      default:
        return fail(change);
    }
  }
  return paths;
}
export function parseDiff(result: DiffProcess): DiffList {
  if (result.status !== 0 || typeof result.stdout !== "string") return { kind: "unreadable" };
  if (result.stdout.length === 0) return { kind: "entries", entries: [] };
  const fields = result.stdout.split("\0");
  if (fields[fields.length - 1] === "") fields.pop();
  const entries: PathChange[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    const filePath = fields[index + 1];
    const initial = status === undefined || status.length === 0 ? "" : status.charAt(0);
    if (filePath === undefined || (initial !== "A" && initial !== "M" && initial !== "T" && initial !== "D")) {
      return { kind: "unreadable" };
    }
    entries.push(initial === "D" ? { kind: "deleted", path: filePath } : { kind: "present", path: filePath });
    index += 2;
  }
  return { kind: "entries", entries };
}
function isCodePath(filePath: string): boolean {
  return CODE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}
function copyTarget(filePath: string): CopyTarget {
  if (filePath.endsWith(".html") && !filePath.startsWith("design/")) return { kind: "raw" };
  if (!isCodePath(filePath)) return { kind: "skip" };
  if (filePath.startsWith("ui/") || filePath.startsWith("server/")) return { kind: "code" };
  return { kind: "skip" };
}
function addMatches(found: ContentFinding[], filePath: string, text: string, origin: number, pattern: RegExp): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
    const at = match.index;
    if (at === undefined) continue;
    found.push({ path: filePath, line: origin + text.slice(0, at).split("\n").length - 1, excerpt: match[0] });
  }
}
function isDigit(ch: string): boolean { return ch >= "0" && ch <= "9"; }
function isLetter(ch: string): boolean { return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z"); }
function isIdentStart(ch: string): boolean { return isLetter(ch) || ch === "_" || ch === "$"; }
function isIdentCont(ch: string): boolean { return isIdentStart(ch) || isDigit(ch); }

function lexSource(source: string, index = 0, line = 1, stop: "eof" | "brace" = "eof"): Lexed {
  const pieces: Piece[] = [];
  let value = false;
  let depth = 0;
  while (index < source.length) {
    const ch = source.charAt(index);
    if (" \t\r\f".includes(ch)) { index += 1; continue; }
    if (ch === "\n") { line += 1; index += 1; continue; }
    if (ch === "/") {
      const next = source.charAt(index + 1);
      if (next === "/") { index += 2; while (index < source.length && source.charAt(index) !== "\n") index += 1; continue; }
      if (next === "*") {
        index += 2;
        while (index < source.length && !(source.charAt(index) === "*" && source.charAt(index + 1) === "/")) {
          if (source.charAt(index) === "\n") line += 1;
          index += 1;
        }
        if (index < source.length) index += 2;
        continue;
      }
      if (value) { value = false; index += 1; continue; }
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const current = source.charAt(index);
        if (current === "\\") { const escaped = source.charAt(index + 1); if (escaped === "\n") line += 1; index += escaped === "" ? 1 : 2; continue; }
        if (current === "[" && !inClass) { inClass = true; index += 1; continue; }
        if (current === "]" && inClass) { inClass = false; index += 1; continue; }
        index += 1;
        if (current === "\n") line += 1;
        if (current === "/" && !inClass) break;
      }
      while (isLetter(source.charAt(index))) index += 1;
      value = true;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      const quote = ch; const startLine = line; let text = "";
      index += 1;
      while (index < source.length) {
        const current = source.charAt(index);
        if (current === "\n") { line += 1; index += 1; break; }
        if (current === "\\") { const escaped = source.charAt(index + 1); text += current + escaped; if (escaped === "\n") line += 1; index += escaped === "" ? 1 : 2; continue; }
        index += 1;
        if (current === quote) break;
        text += current;
      }
      pieces.push({ kind: "string", text, line: startLine });
      value = true;
      continue;
    }
    if (ch === "`") {
      index += 1;
      const slots: TemplateSlot[] = [];
      let buffer = ""; let bufferLine = line; let interpolations = 0; let closed = false;
      while (index < source.length) {
        const current = source.charAt(index);
        if (current === "\\") { const escaped = source.charAt(index + 1); buffer += current + escaped; if (escaped === "\n") line += 1; index += escaped === "" ? 1 : 2; continue; }
        if (current === "`") { slots.push({ kind: "text", text: buffer, line: bufferLine }); index += 1; closed = true; break; }
        if (current === "$" && source.charAt(index + 1) === "{") {
          slots.push({ kind: "text", text: buffer, line: bufferLine });
          buffer = ""; index += 2; interpolations += 1;
          const inner = lexSource(source, index, line, "brace");
          slots.push({ kind: "hole", pieces: inner.pieces });
          index = inner.index; line = inner.line; bufferLine = line;
          continue;
        }
        if (current === "\n") line += 1;
        buffer += current; index += 1;
      }
      if (!closed) slots.push({ kind: "text", text: buffer, line: bufferLine });
      pieces.push({ kind: "template", slots, interpolations });
      value = true;
      continue;
    }
    if (isDigit(ch)) { while (index < source.length && isDigit(source.charAt(index))) index += 1; value = true; continue; }
    if (isIdentStart(ch)) {
      const start = index; const identLine = line; index += 1;
      while (index < source.length && isIdentCont(source.charAt(index))) index += 1;
      const text = source.slice(start, index);
      if (KEYWORDS.has(text)) value = false; else { pieces.push({ kind: "identifier", text, line: identLine }); value = true; }
      continue;
    }
    if ((ch === "+" || ch === "-") && source.charAt(index + 1) === ch) { index += 2; continue; }
    if (ch === ")" || ch === "]") { value = true; index += 1; continue; }
    if (ch === "{") { depth += 1; value = false; index += 1; continue; }
    if (ch === "}") {
      if (stop === "brace" && depth === 0) return { pieces, index: index + 1, line };
      if (depth > 0) depth -= 1;
      value = false; index += 1; continue;
    }
    value = false; index += 1;
  }
  return { pieces, index, line };
}
function walk(filePath: string, pieces: readonly Piece[], pattern: RegExp, found: ContentFinding[]): void {
  for (const piece of pieces) {
    switch (piece.kind) {
      case "string":
        addMatches(found, filePath, piece.text, piece.line, pattern);
        break;
      case "identifier":
        break;
      case "template":
        for (const slot of piece.slots) {
          switch (slot.kind) {
            case "text":
              addMatches(found, filePath, slot.text, slot.line, pattern);
              break;
            case "hole":
              walk(filePath, slot.pieces, pattern, found);
              break;
            default:
              return fail(slot);
          }
        }
        break;
      default:
        return fail(piece);
    }
  }
}
function collect(file: TextFile, pattern: RegExp): readonly ContentFinding[] {
  const found: ContentFinding[] = [];
  walk(file.path, lexSource(file.text).pieces, pattern, found);
  return found;
}
function scanRaw(file: TextFile, pattern: RegExp): readonly ContentFinding[] {
  const found: ContentFinding[] = [];
  addMatches(found, file.path, file.text, 1, pattern);
  return found;
}

export function parseBannedWords(text: string): readonly string[] {
  const words: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().toLowerCase();
    if (line === "" || line.startsWith("#")) continue;
    if (!WORD.test(line)) throw new Error(`banned word ${JSON.stringify(line)}`);
    words.push(line);
  }
  return words;
}
function bannedPattern(words: readonly string[]): RegExp | undefined {
  if (words.length === 0) return undefined;
  return new RegExp(`\\b(?:${words.map((word) => word.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b`, "i");
}
export function judgeCopy(file: TextFile, words: readonly string[]): readonly ContentFinding[] {
  const pattern = bannedPattern(words);
  if (pattern === undefined) return [];
  const target = copyTarget(file.path);
  switch (target.kind) {
    case "skip": return [];
    case "raw": return scanRaw(file, pattern);
    case "code": return collect(file, pattern);
    default: return fail(target);
  }
}
function isCommand(value: string | undefined): value is Command {
  return value === "plan" || value === "copy";
}
function readDiff(base: string): DiffProcess {
  const result = spawnSync("git", ["diff", "-z", "--name-status", "--no-renames", `${base}...HEAD`], { encoding: "utf8", shell: false });
  return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : undefined };
}
function writeOutput(plan: ContentPlan): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) process.exit(1);
  appendFileSync(outputPath, plan.output);
}
function readBannedWords(): readonly string[] {
  if (!existsSync(BANNED_WORDS_FILE)) return [];
  try {
    return parseBannedWords(readFileSync(BANNED_WORDS_FILE, "utf8"));
  } catch {
    process.exit(1);
  }
}
function report(plan: ContentPlan, entries: readonly PathChange[]): void {
  if (!plan.scan) return;
  const words = readBannedWords();
  let failed = false;
  for (const filePath of pathsToRead(entries)) {
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      process.exit(1);
    }
    for (const finding of judgeCopy({ path: filePath, text }, words)) {
      failed = true;
      process.stderr.write(`${finding.path}:${String(finding.line)}:${finding.excerpt}\n`);
    }
  }
  if (failed) process.exit(1);
}
function runCommand(command: Command, entries: readonly PathChange[]): void {
  const plan = planContentScan(entries.map((entry) => entry.path));
  switch (command) {
    case "plan": writeOutput(plan); return;
    case "copy": report(plan, entries); return;
    default: return fail(command);
  }
}
function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const command = process.argv[2];
  if (!isCommand(command)) process.exit(1);
  const base = process.env.BASE_SHA;
  if (base === undefined || !SHA.test(base)) process.exit(1);
  const diff = parseDiff(readDiff(base));
  if (diff.kind === "unreadable") process.exit(1);
  if (diff.kind === "entries") runCommand(command, diff.entries);
  else fail(diff);
}

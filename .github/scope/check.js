import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const FIXTURE_DATA = ["json", "sql", "csv", "txt", "png", "jpg", "heic"];
const FIXTURE_SET = new Set(FIXTURE_DATA);

function stripComment(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "#") return line.slice(0, index);
  }
  return line;
}

function parseScalar(text) {
  if (text === "[]") return [];
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return /^-?\d+$/.test(text) ? Number(text) : text;
}

export function parseLaneMap(text) {
  const lanes = [];
  let lane = null;
  let list = null;
  let size = null;
  for (const raw of text.split("\n")) {
    if (raw.includes("\t")) throw new Error("lanes.yml cannot use tabs");
    const line = stripComment(raw).trimEnd();
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    const content = line.trim();
    if (content.startsWith("- ")) {
      const item = parseScalar(content.slice(2).trim());
      if (list === null) continue;
      if (typeof item !== "string") throw new Error("lanes.yml list item is not a string");
      list.push(item);
      continue;
    }
    const colon = content.indexOf(":");
    if (colon < 0) throw new Error("lanes.yml has a line without a key");
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();
    list = null;
    if (indent === 0) {
      size = key === "size" ? {} : size;
      continue;
    }
    if (size === null && indent === 2 && rest === "") {
      lane = { name: key, paths: [] };
      lanes.push(lane);
      continue;
    }
    if (size === null && key === "paths" && rest === "" && lane !== null) {
      list = lane.paths;
      continue;
    }
    if (size === null) continue;
    if (rest === "[]") size[key] = [];
    else if (rest === "") {
      size[key] = [];
      list = size[key];
    } else size[key] = parseScalar(rest);
  }
  const cap = (key) => {
    const value = size?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
    return value;
  };
  const strings = (key) => {
    const value = size?.[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${key} must be a list of strings`);
    return value;
  };
  if (lanes.length === 0) throw new Error("lanes must be a map");
  return {
    lanes,
    appLinesMax: cap("app_lines_max"),
    testLinesMax: cap("test_lines_max"),
    docsLinesMax: cap("docs_lines_max"),
    testPaths: strings("test_paths"),
    fixturePaths: strings("fixture_paths"),
    docsPaths: strings("docs_paths"),
    generatedPaths: strings("generated_paths"),
  };
}
function matchSegment(pattern, segment) {
  const expression = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${expression}$`).test(segment);
}
function matchParts(pattern, parts) {
  let patternIndex = 0;
  let partIndex = 0;
  while (patternIndex < pattern.length && partIndex < parts.length) {
    if (pattern[patternIndex] === "**") {
      if (patternIndex === pattern.length - 1) return true;
      for (let skip = partIndex; skip <= parts.length; skip += 1) {
        if (matchParts(pattern.slice(patternIndex + 1), parts.slice(skip))) return true;
      }
      return false;
    }
    if (!matchSegment(pattern[patternIndex], parts[partIndex])) return false;
    patternIndex += 1;
    partIndex += 1;
  }
  return patternIndex === pattern.length && partIndex === parts.length;
}
function matchesAny(patterns, filePath) {
  return patterns.some((pattern) => matchParts(pattern.split("/"), filePath.split("/")));
}
function extensionOf(filePath) {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}
function laneFor(map, filePath) {
  const names = map.lanes.filter((lane) => matchesAny(lane.paths, filePath)).map((lane) => lane.name);
  if (names.length > 1) return { kind: "ambiguous", names };
  if (names.length === 1) return { kind: "one", name: names[0] };
  if (!filePath.includes("/")) return { kind: "one", name: "config" };
  return { kind: "unlisted" };
}
function classOf(map, filePath) {
  if (matchesAny(map.generatedPaths, filePath)) return "generated";
  if (matchesAny(map.testPaths, filePath)) return "test";
  if (matchesAny(map.fixturePaths, filePath)) {
    return FIXTURE_SET.has(extensionOf(filePath)) ? "fixture" : "illegal-fixture";
  }
  return matchesAny(map.docsPaths, filePath) ? "docs" : "app";
}
function bodySaysWhy(body) {
  const trimmed = body.trim();
  return trimmed !== "" && !/^cross-lane$/i.test(trimmed);
}
export function judgeScope(map, input) {
  const reasons = [];
  const laneNames = new Set();
  const lines = { app: 0, test: 0, docs: 0 };
  for (const file of input.files) {
    const lane = laneFor(map, file.path);
    if (lane.kind === "ambiguous") {
      reasons.push(`${file.path} matches more than one lane: ${lane.names.slice().sort().join(", ")}`);
    } else if (lane.kind === "unlisted") reasons.push(`${file.path} is in a folder no lane lists`);
    else laneNames.add(lane.name);
    const bucket = classOf(map, file.path);
    if (bucket === "illegal-fixture") {
      reasons.push(`${file.path} is a fixture and is not data (${FIXTURE_DATA.join(", ")})`);
      continue;
    }
    if (bucket === "generated") {
      const proof = input.generated.find((item) => item.path === file.path);
      if (proof === undefined || proof.clean !== true) reasons.push(`${file.path} is generated and the regeneration differs`);
      continue;
    }
    const changed = file.additions + file.deletions;
    if (bucket === "test" || bucket === "fixture") lines.test += changed;
    else if (bucket === "docs") lines.docs += changed;
    else lines.app += changed;
  }
  if (laneNames.size > 1) {
    const listed = [...laneNames].sort().join(", ");
    if (!input.labels.includes("cross-lane")) reasons.push(`cross-lane label is required for lanes ${listed}`);
    if (!bodySaysWhy(input.body)) reasons.push("pull request body does not say why it spans lanes");
  }
  if (lines.app > map.appLinesMax) reasons.push(`app lines ${lines.app} exceed ${map.appLinesMax}`);
  if (lines.test > map.testLinesMax) reasons.push(`test and fixture lines ${lines.test} exceed ${map.testLinesMax}`);
  if (lines.docs > map.docsLinesMax) reasons.push(`docs lines ${lines.docs} exceed ${map.docsLinesMax}`);
  return { ok: reasons.length === 0, reasons, lanes: [...laneNames].sort(), lines };
}
export function judgeRedFirst(input) {
  if (!input.touchedTestPaths || input.failedCount > 0) return { ok: true, reasons: [] };
  return { ok: false, reasons: ["the first commit changes tests and none of them fail"] };
}
function diffPath(pathField) {
  const brace = pathField.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace !== null) return `${brace[1]}${brace[3]}${brace[4]}`;
  const arrow = pathField.indexOf(" => ");
  return arrow === -1 ? pathField : pathField.slice(arrow + 4);
}
function count(text) {
  if (text === "-") return 0;
  if (!/^\d+$/.test(text)) throw new Error(`bad numstat count ${text}`);
  return Number(text);
}
export function parseNumstat(text) {
  return text.split("\n").flatMap((raw) => {
    const line = raw.replace(/\r$/, "");
    if (line === "") return [];
    const parts = line.split("\t");
    if (parts.length < 3) throw new Error("numstat line is short");
    return [{ path: diffPath(parts.slice(2).join("\t")), additions: count(parts[0]), deletions: count(parts[1]) }];
  });
}
export function testFilesToRun(nameStatus, testPaths) {
  const paths = [];
  for (const raw of nameStatus.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("D") || status.startsWith("U")) continue;
    const candidate = status.startsWith("R") || status.startsWith("C") ? parts[2] : parts[1];
    if (candidate !== undefined && candidate !== "" && matchesAny(testPaths, candidate)) paths.push(candidate);
  }
  return paths;
}
export function proofsWithoutRegeneration(map, files) {
  return files.filter((file) => matchesAny(map.generatedPaths, file.path)).map((file) => ({ path: file.path, clean: false }));
}
export function requireCommitSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("commit sha is required");
  return value;
}
export function pullRequestLabels(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("pull request labels must be a list of strings");
  return parsed;
}
function gitText(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || args[0]);
  return result.stdout ?? "";
}
function runScope() {
  const base = requireCommitSha(process.env.BASE_SHA ?? "");
  const map = parseLaneMap(readFileSync("program/lanes.yml", "utf8"));
  const files = parseNumstat(gitText(["diff", "--numstat", "--find-renames", `${base}...HEAD`]));
  const verdict = judgeScope(map, {
    files,
    labels: pullRequestLabels(process.env.PR_LABELS ?? "[]"),
    body: process.env.PR_BODY ?? "",
    generated: proofsWithoutRegeneration(map, files),
  });
  if (!verdict.ok) {
    process.stderr.write(`${verdict.reasons.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`lane ${verdict.lanes.join(", ") || "none"}\n`);
}
function runRedFirst() {
  const base = requireCommitSha(process.env.BASE_SHA ?? "");
  const first = gitText(["rev-list", "--reverse", `${base}..HEAD`]).split("\n").find((line) => line !== "");
  if (first === undefined) return;
  const map = parseLaneMap(readFileSync("program/lanes.yml", "utf8"));
  const tests = testFilesToRun(gitText(["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", first]), map.testPaths);
  if (tests.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), "red-first-"));
  let added = false;
  try {
    gitText(["worktree", "add", "--detach", dir, first]);
    added = true;
    const install = spawnSync("npm", ["ci"], { cwd: dir, encoding: "utf8" });
    if (install.status !== 0) {
      process.stderr.write(install.stderr ?? "");
      throw new Error("red-first could not install dependencies at the first commit");
    }
    const ran = spawnSync(join(dir, "node_modules/.bin/tsx"), ["--test", ...tests], { cwd: dir, stdio: "inherit" });
    if (ran.error !== undefined || ran.status === null) throw new Error("red-first could not run the tests");
    const verdict = judgeRedFirst({ touchedTestPaths: true, failedCount: ran.status === 0 ? 0 : 1 });
    if (!verdict.ok) {
      process.stderr.write(`${verdict.reasons.join("\n")}\n`);
      process.exitCode = 1;
    }
  } finally {
    if (added) spawnSync("git", ["worktree", "remove", "--force", dir], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
  }
}
function main() {
  try {
    const command = process.argv[2];
    if (command === "scope") runScope();
    else if (command === "red-first") runRedFirst();
    else throw new Error("usage: check.js scope|red-first");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "check failed"}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

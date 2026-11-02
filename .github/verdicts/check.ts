import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REVIEW_APP = "crew-review[bot]";
const PATH_ROLES = ["qa", "cto", "designer"] as const;
const ROLE_FOR_KEY = { qa_paths: "qa", risk_paths: "cto", design_paths: "designer" } as const;
const FINGERPRINT_LINE = /^verdict-code ([a-z0-9-]+) ([0-9a-f]{40}) ([0-9a-f]{64})$/i;
const VERDICT_LINE = /^(PASS|PASS\+NOTES|FAIL) \(([a-z0-9-]+)\) at ([0-9a-f]{40})$/i;
const CODE_LINE = /^code (\S+)$/;
const SHA = /^[0-9a-f]{40}$/i;
type PathRole = (typeof PATH_ROLES)[number];
type Outcome = "PASS" | "PASS+NOTES" | "FAIL";
type RoleNeed = { readonly role: string; readonly globs: readonly string[] | null };
type Fingerprint = { readonly role: string; readonly head: string; readonly hash: string };
type ParsedVerdict = { readonly login: string; readonly outcome: Outcome; readonly role: string; readonly head: string; readonly code: string };
export type VerdictReport = { readonly pass: boolean; readonly required: readonly string[]; readonly message: string };
export type VerdictInput = {
  readonly changedPaths: readonly string[];
  readonly labels: readonly string[];
  readonly lanesYaml: string;
  readonly comments: readonly { readonly body: string }[];
  readonly reviews: readonly { readonly login: string; readonly body: string }[];
  readonly currentHead: string;
  readonly patchId: (head: string, globs: readonly string[] | null) => string;
};
export type EventGate = { readonly name: string; readonly reviewLogin: string | null; readonly commentBody: string | null; readonly commentOnPullRequest: boolean };

export function eventRunsJob(event: EventGate): boolean {
  if (event.name === "pull_request") return true;
  if (event.name === "pull_request_review") return event.reviewLogin === REVIEW_APP;
  if (event.name === "issue_comment") {
    return event.commentOnPullRequest && (event.commentBody ?? "").startsWith("verdict-code");
  }
  return false;
}
export function gateFor(name: string, payload: unknown): { readonly run: boolean; readonly number: number } {
  const root = record(payload);
  if (!root) throw new Error("event payload is not an object");
  if (name === "pull_request" || name === "pull_request_review") {
    const pull = record(root.pull_request);
    const number = pull ? integer(pull.number) : null;
    if (number === null) throw new Error("event has no pull request number");
    const user = record(record(root.review)?.user);
    return {
      run: eventRunsJob({
        name,
        reviewLogin: user ? text(user.login) : null,
        commentBody: null,
        commentOnPullRequest: false,
      }),
      number,
    };
  }
  if (name === "issue_comment") {
    const issue = record(root.issue);
    const number = issue ? integer(issue.number) : null;
    if (number === null) throw new Error("event has no issue number");
    return {
      run: eventRunsJob({
        name,
        reviewLogin: null,
        commentBody: text(record(root.comment)?.body),
        commentOnPullRequest: record(issue?.pull_request) !== null,
      }),
      number,
    };
  }
  return { run: false, number: 0 };
}

export function evaluateVerdicts(input: VerdictInput): VerdictReport {
  const roles = requiredRoles(input.changedPaths, input.labels, pathGlobs(input.lanesYaml));
  const required = roles.map((role) => role.role);
  const fingerprints = input.comments.flatMap((comment) => {
    const parsed = parseFingerprint(comment.body);
    return parsed ? [parsed] : [];
  });
  const duplicate = duplicateFingerprint(fingerprints);
  if (duplicate) {
    return {
      pass: false,
      required,
      message: `two fingerprints for the same role and head: ${duplicate.role} at ${duplicate.head}`,
    };
  }
  if (roles.length === 0) return { pass: true, required, message: "no required role" };
  const byHead = new Map(fingerprints.map((item) => [`${item.role}\n${item.head}`, item.hash]));
  const used = new Set<string>();
  const failures = roles.flatMap((role) => {
    const failure = unmatched(role, input, byHead, used);
    return failure ? [failure] : [];
  });
  if (failures.length > 0) return { pass: false, required, message: failures.join("\n") };
  return { pass: true, required, message: "verdicts pass" };
}

export function gitChangedPaths(repo: string, base: string, head: string): readonly string[] {
  const text = git(repo, ["diff", "--name-status", git(repo, ["merge-base", base, head]).trim(), head]);
  return text.split("\n").flatMap((line) => (line === "" ? [] : line.split("\t").slice(1).filter((part) => part !== "")));
}
export function gitPatchId(repo: string, base: string, head: string, globs: readonly string[] | null): string {
  const args = ["diff", git(repo, ["merge-base", base, head]).trim(), head];
  if (globs) args.push("--", ...globs.map((glob) => `:(glob)${glob}`));
  const diff = git(repo, args);
  if (diff === "") return "empty";
  const id = git(repo, ["patch-id", "--stable"], diff).trim().split(/\s+/)[0];
  if (!id) throw new Error("git patch-id returned nothing");
  return id;
}

function requiredRoles(
  changedPaths: readonly string[],
  labels: readonly string[],
  globs: Readonly<Record<PathRole, readonly string[]>>,
): readonly RoleNeed[] {
  const needs = new Map<string, readonly string[] | null>();
  for (const role of PATH_ROLES) {
    const list = globs[role];
    if (changedPaths.some((file) => list.some((glob) => globToRegExp(glob).test(file)))) needs.set(role, list);
  }
  for (const label of labels) {
    const role = /^verify:([a-z0-9-]+)$/i.exec(label)?.[1]?.toLowerCase();
    if (role && !needs.has(role)) needs.set(role, null);
  }
  return [...needs.entries()].map(([role, roleGlobs]) => ({ role, globs: roleGlobs }));
}
function pathGlobs(yaml: string): Record<PathRole, readonly string[]> {
  const globs: Record<PathRole, string[]> = { qa: [], cto: [], designer: [] };
  const seen = new Set<PathRole>();
  let current: PathRole | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const keyName = /^(qa_paths|risk_paths|design_paths):\s*(?:#.*)?$/.exec(line)?.[1];
    if (keyName === "qa_paths" || keyName === "risk_paths" || keyName === "design_paths") {
      current = ROLE_FOR_KEY[keyName];
      seen.add(current);
      continue;
    }
    if (/^\S/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const item = /^\s+-\s+"([^"]+)"\s*(?:#.*)?$/.exec(line)?.[1];
    if (!item) throw new Error(`lanes.yml has an unreadable path: ${trimmed}`);
    globs[current].push(item);
  }
  if (!seen.has("qa") || !seen.has("cto") || !seen.has("designer")) {
    throw new Error("lanes.yml is missing qa_paths, risk_paths, or design_paths");
  }
  return globs;
}
function duplicateFingerprint(items: readonly Fingerprint[]): Fingerprint | null {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.role}\n${item.head}`;
    if (seen.has(key)) return item;
    seen.add(key);
  }
  return null;
}

function unmatched(
  role: RoleNeed,
  input: VerdictInput,
  byHead: ReadonlyMap<string, string>,
  used: Set<string>,
): string | null {
  let reason = "no counted verdict";
  for (const review of input.reviews) {
    const parsed = parseVerdict(review.login, review.body);
    if (!parsed || parsed.role !== role.role) continue;
    if (parsed.login !== REVIEW_APP) {
      reason = "another account";
      continue;
    }
    const hash = byHead.get(`${parsed.role}\n${parsed.head}`);
    if (!hash) continue;
    if (createHash("sha256").update(parsed.code).digest("hex") !== hash) {
      reason = "wrong code";
      continue;
    }
    if (!passing(parsed.outcome)) {
      reason = "FAIL";
      continue;
    }
    if (used.has(parsed.code)) {
      reason = "reused code";
      continue;
    }
    if (input.patchId(parsed.head, role.globs) !== input.patchId(input.currentHead, role.globs)) {
      reason = "patch-id";
      continue;
    }
    used.add(parsed.code);
    return null;
  }
  return `${role.role}: ${reason}`;
}
function passing(outcome: Outcome): boolean {
  switch (outcome) {
    case "PASS":
    case "PASS+NOTES":
      return true;
    case "FAIL":
      return false;
    default: {
      const unexpected: never = outcome;
      throw new Error(unexpected);
    }
  }
}
function parseFingerprint(body: string): Fingerprint | null {
  const match = FINGERPRINT_LINE.exec(body.split(/\r?\n/, 1)[0]?.trim() ?? "");
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { role: match[1].toLowerCase(), head: match[2].toLowerCase(), hash: match[3].toLowerCase() };
}
function parseVerdict(login: string, body: string): ParsedVerdict | null {
  const lines = body.split(/\r?\n/);
  const header = VERDICT_LINE.exec(lines[0]?.trim() ?? "");
  const code = CODE_LINE.exec(lines[1]?.trim() ?? "");
  const outcome = header?.[1]?.toUpperCase();
  if (!header?.[2] || !header[3] || !code?.[1] || !isOutcome(outcome)) return null;
  return { login, outcome, role: header[2].toLowerCase(), head: header[3].toLowerCase(), code: code[1] };
}
function isOutcome(value: string | undefined): value is Outcome {
  return value === "PASS" || value === "PASS+NOTES" || value === "FAIL";
}
function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    source += char === "*" ? "[^/]*" : (/[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char);
  }
  return new RegExp(`${source}$`);
}
function git(repo: string, args: readonly string[], input?: string): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0] ?? "command"} failed`);
  return result.stdout;
}
function ensureCommit(repo: string, sha: string): void {
  const present = () => spawnSync("git", ["-C", repo, "cat-file", "-e", `${sha}^{commit}`]).status === 0;
  if (present()) return;
  git(repo, ["fetch", "--no-tags", "origin", sha]);
  if (!present()) throw new Error(`missing commit ${sha}`);
}

async function run(): Promise<number> {
  const gate = gateFor(env("GITHUB_EVENT_NAME"), JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8")));
  if (!gate.run) {
    process.stdout.write("verdicts skipped\n");
    return 0;
  }
  const token = env("GITHUB_TOKEN");
  const repository = env("GITHUB_REPOSITORY");
  const repo = process.cwd();
  const pull = await loadPull(token, repository, gate.number);
  git(repo, ["fetch", "--no-tags", "origin", `pull/${gate.number}/head`]);
  ensureCommit(repo, pull.headSha);
  ensureCommit(repo, pull.baseSha);
  const report = evaluateVerdicts({
    changedPaths: gitChangedPaths(repo, pull.baseSha, pull.headSha),
    labels: pull.labels,
    lanesYaml: git(repo, ["show", `${pull.headSha}:program/lanes.yml`]),
    comments: await loadComments(token, repository, gate.number),
    reviews: await loadReviews(token, repository, gate.number),
    currentHead: pull.headSha,
    patchId: (head, globs) => gitPatchId(repo, pull.baseSha, head, globs),
  });
  process.stdout.write(`required: ${report.required.join(", ")}\n${report.message}\n`);
  if (!report.pass) {
    process.stdout.write(`::error::${report.message.replaceAll("\n", " ")}\n`);
    return 1;
  }
  return 0;
}

async function loadPull(token: string, repository: string, number: number) {
  const root = record((await github(token, `/repos/${repoSlug(repository)}/pulls/${number}`)).body);
  const headSha = text(record(root?.head)?.sha);
  const baseSha = text(record(root?.base)?.sha);
  if (!root || !headSha || !baseSha || !SHA.test(headSha) || !SHA.test(baseSha)) {
    throw new Error("pull request is missing a head sha or base sha");
  }
  return { headSha: headSha.toLowerCase(), baseSha: baseSha.toLowerCase(), labels: readLabels(root.labels) };
}
async function loadComments(token: string, repository: string, number: number) {
  const items = await githubList(token, `/repos/${repoSlug(repository)}/issues/${number}/comments?per_page=100`);
  return items.flatMap((item) => {
    const body = text(record(item)?.body);
    return body === null ? [] : [{ body }];
  });
}
async function loadReviews(token: string, repository: string, number: number) {
  const items = await githubList(token, `/repos/${repoSlug(repository)}/pulls/${number}/reviews?per_page=100`);
  return items.flatMap((item) => {
    const row = record(item);
    const login = text(record(row?.user)?.login);
    const body = text(row?.body);
    return login && body !== null ? [{ login, body }] : [];
  });
}
function readLabels(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("pull request labels are missing");
  return value.map((item) => {
    const name = text(record(item)?.name);
    if (!name) throw new Error("pull request label is missing a name");
    return name;
  });
}
async function githubList(token: string, pathName: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: string | null = `https://api.github.com${pathName}`;
  while (next) {
    const page = await github(token, next);
    if (!Array.isArray(page.body)) throw new Error("GitHub API list was not an array");
    items.push(...page.body);
    next = linkNext(page.link);
  }
  return items;
}
async function github(token: string, url: string): Promise<{ readonly body: unknown; readonly link: string | null }> {
  const response = await fetch(url.startsWith("https://") ? url : `https://api.github.com${url}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "app-verdicts", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const body: unknown = await response.json();
  return { body, link: response.headers.get("link") };
}
function linkNext(header: string | null): string | null {
  const found = header?.split(",").map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1]).find((url) => url?.startsWith("https://api.github.com/"));
  return found ?? null;
}
function repoSlug(repository: string): string {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("GITHUB_REPOSITORY is not owner/repo");
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}
function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "verdicts failed"}\n`);
      process.exitCode = 1;
    });
}

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate as applyMigrations } from "../../db/migrate.js";

const NEON = "https://console.neon.tech/api/v2", NETLIFY = "https://api.netlify.com/api/v1", GITHUB = "https://api.github.com";
const PREVIEW_NAME = /^preview\/pr-([1-9]\d*)$/, SQL_FILE = /^db\/[^/]+\.sql$/, SHA = /^[0-9a-f]{40}$/;
const PG_URL = /^(postgres|postgresql):\/\/\S+$/, PG_ANY = /postgres(?:ql)?:\/\/\S+/gi;

export type BranchRecord = { readonly id: string; readonly name: string; readonly parentId: string };
export type CopyPlan = { readonly kind: "skip" } | { readonly kind: "copy"; readonly pr: number; readonly name: string };
export type MigratePlan = { readonly kind: "skip" } | { readonly kind: "migrate" };
export type EnsureDecision = { readonly kind: "reuse"; readonly branch: BranchRecord } | { readonly kind: "create"; readonly parentId: string } | { readonly kind: "full" } | { readonly kind: "stop"; readonly reason: "duplicate copy" | "parent is not dev" };
export type SweepPlan = { readonly kind: "delete" } | { readonly kind: "keep" };
export type PrState = "open" | "closed" | "missing";
export type HttpInput = { readonly method: string; readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body?: string };
export type HttpResult = { readonly status: number; readonly body: string; readonly link: string | null };
export type Http = (input: HttpInput) => Promise<HttpResult>;
export type MigrateFn = (databaseUrl: string, dir: string) => Promise<unknown>;
export type Io = { readonly env: NodeJS.ProcessEnv; readonly cwd: string; readonly http: Http; readonly migrate: MigrateFn; readonly sleep: () => Promise<void>; readonly stdout: (line: string) => void; readonly stderr: (line: string) => void };
type NeonAuth = { readonly project: string; readonly key: string };
type NetlifyAuth = { readonly token: string; readonly site: string };
type GitHubAuth = { readonly owner: string; readonly repo: string; readonly token: string };
type GhFile = { readonly filename: string; readonly status: string; readonly previousFilename?: string; readonly contentsUrl?: string };
type EnvValue = { readonly id: string; readonly context: string; readonly contextParameter: string };
type HeaderKind = "get" | "json" | "github" | "raw";

function unexpected(value: never): never { throw new Error(`unexpected ${JSON.stringify(value)}`); }
function hits(file: string, roots: readonly string[]): boolean { return roots.some((root) => file === root || file.startsWith(`${root}/`)); }
export function planCopy(pr: number, paths: readonly string[]): CopyPlan {
  return paths.some((file) => hits(file, ["db", "server"])) ? { kind: "copy", pr, name: `preview/pr-${pr}` } : { kind: "skip" }; }
export function planDevMigrate(input: readonly string[] | "unknown"): MigratePlan {
  return input === "unknown" || input.some((file) => hits(file, ["db"])) ? { kind: "migrate" } : { kind: "skip" }; }
function previewPr(name: string): number | undefined {
  const match = PREVIEW_NAME.exec(name);
  return match?.[1] === undefined ? undefined : Number(match[1]); }
function named(branches: readonly BranchRecord[], name: string): BranchRecord[] { return branches.filter((branch) => branch.name === name); }
export function ensureDecision(name: string, branches: readonly BranchRecord[]): EnsureDecision {
  const copies = named(branches, name);
  if (copies.length > 1) return { kind: "stop", reason: "duplicate copy" };
  const dev = named(branches, "dev");
  const parent = dev.length === 1 ? dev[0] : undefined;
  if (parent === undefined) return { kind: "stop", reason: "parent is not dev" };
  if (named(branches, "production").some((branch) => branch.id === parent.id)) return { kind: "stop", reason: "parent is not dev" };
  const existing = copies[0];
  if (existing !== undefined) return existing.parentId === parent.id ? { kind: "reuse", branch: existing } : { kind: "stop", reason: "parent is not dev" };
  return branches.filter((branch) => previewPr(branch.name) !== undefined).length >= 8 ? { kind: "full" } : { kind: "create", parentId: parent.id }; }
export function planSweep(state: PrState): SweepPlan {
  switch (state) {
    case "closed": return { kind: "delete" };
    case "open": case "missing": return { kind: "keep" };
    default: return unexpected(state); } }
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret !== "") out = out.split(secret).join("[redacted]");
  return out.replace(PG_ANY, "[redacted]"); }
function prove(io: Io, line: string, secrets: readonly string[]): void {
  if (line.includes("\n") || redact(line, [...secrets, ...secretValues(io.env)]) !== line) return;
  io.stdout(`${line}\n`); }
function appliedNames(result: unknown): string[] {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return [];
  const applied = (result as { applied?: unknown }).applied;
  if (!Array.isArray(applied)) return [];
  const names: string[] = [];
  for (const item of applied) if (typeof item === "string" && item !== "") names.push(item);
  return names; }
const FAILURE_LIMIT = 240;
function nestedText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(nestedText).filter((item) => item !== "").join("; ");
  if (value === null || typeof value !== "object") return "";
  const text = JSON.stringify(value);
  return text === "{}" ? "" : text; }
function jsonMessage(body: string): string {
  try {
    const value: unknown = JSON.parse(body);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return nestedText(value);
    const row = value as { message?: unknown; msg?: unknown; errors?: unknown };
    if (typeof row.message === "string" && row.message.trim() !== "") return row.message.trim();
    if (typeof row.msg === "string" && row.msg.trim() !== "") return row.msg.trim();
    return row.errors === undefined ? "" : nestedText(row.errors);
  } catch { return ""; } }
function failureDetail(body: string): string {
  const text = redact(jsonMessage(body) || body, []).replace(/\s+/g, " ").trim();
  return text.length <= FAILURE_LIMIT ? text : `${text.slice(0, FAILURE_LIMIT)}...`; }
function readJson(body: string, label: string): unknown { try { return JSON.parse(body) as unknown; } catch { throw new Error(label); } }
function rec(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>; }
function str(value: unknown, label: string): string { if (typeof value !== "string" || value === "") throw new Error(label); return value; }
function strOpt(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(label);
  return value; }
function httpFail(method: string, url: string, status: number, body: string): Error {
  const detail = failureDetail(body);
  const head = `${method} ${new URL(url).pathname} ${status}`;
  return new Error(detail === "" ? head : `${head} ${detail}`); }
function need(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value; }
function prNumber(value: string): number { if (!/^[1-9]\d*$/.test(value)) throw new Error("PR_NUMBER is invalid"); return Number(value); }
function repoPair(value: string): { owner: string; repo: string } {
  const slash = value.indexOf("/");
  const repo = slash < 0 ? "" : value.slice(slash + 1);
  if (slash <= 0 || repo === "" || repo.includes("/")) throw new Error("GITHUB_REPOSITORY is invalid");
  return { owner: value.slice(0, slash), repo }; }
function neonAuth(env: NodeJS.ProcessEnv): NeonAuth { return { project: need(env, "NEON_PROJECT_ID"), key: need(env, "NEON_API_KEY") }; }
function netlifyAuth(env: NodeJS.ProcessEnv): NetlifyAuth { return { token: need(env, "NETLIFY_AUTH_TOKEN"), site: need(env, "NETLIFY_SITE_ID") }; }
function githubAuth(env: NodeJS.ProcessEnv): GitHubAuth { return { ...repoPair(need(env, "GITHUB_REPOSITORY")), token: need(env, "GITHUB_TOKEN") }; }
function refuseFork(io: Io): boolean { if (io.env.FORK === "false") return false; io.stderr("refusing a fork\n"); return true; }
function headers(token: string, kind: HeaderKind): Record<string, string> {
  const out: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (kind === "json") out["Content-Type"] = "application/json";
  if (kind === "github" || kind === "raw") Object.assign(out, { Accept: kind === "raw" ? "application/vnd.github.raw" : "application/vnd.github+json", "User-Agent": "app-db-copies", "X-GitHub-Api-Version": "2022-11-28" });
  return out; }
async function call(io: Io, method: string, url: string, token: string, kind: HeaderKind, ok: readonly number[], body?: unknown): Promise<HttpResult> {
  const res = await io.http({ method, url, headers: headers(token, kind), body: body === undefined ? undefined : JSON.stringify(body) });
  if (ok.length > 0 && !ok.includes(res.status)) throw httpFail(method, url, res.status, res.body);
  return res; }
function projectUrl(project: string, suffix: string): string { return `${NEON}/projects/${encodeURIComponent(project)}${suffix}`; }
function parseBranch(value: unknown): BranchRecord {
  const row = rec(value, "neon branch");
  return { id: str(row.id, "neon branch"), name: str(row.name, "neon branch"), parentId: strOpt(row.parent_id, "neon branch") ?? "" }; }
async function listBranches(io: Io, neon: NeonAuth): Promise<BranchRecord[]> {
  const res = await call(io, "GET", projectUrl(neon.project, "/branches"), neon.key, "get", [200]);
  const branches = rec(readJson(res.body, "neon branches"), "neon branches").branches;
  if (!Array.isArray(branches)) throw new Error("neon branches");
  return branches.map(parseBranch); }
function deletable(branch: BranchRecord): boolean { return branch.name !== "production" && branch.name !== "dev" && previewPr(branch.name) !== undefined; }
async function deleteBranch(io: Io, neon: NeonAuth, branch: BranchRecord): Promise<void> {
  if (!deletable(branch)) throw new Error("refusing delete");
  await call(io, "DELETE", projectUrl(neon.project, `/branches/${encodeURIComponent(branch.id)}`), neon.key, "get", [200, 204, 404]); }
function isLimit(status: number, body: string): boolean { return (status === 422 || status === 409) && /branch/i.test(jsonMessage(body)) && /limit/i.test(jsonMessage(body)); }
async function waitOperation(io: Io, neon: NeonAuth, operation: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await call(io, "GET", projectUrl(neon.project, `/operations/${encodeURIComponent(operation)}`), neon.key, "get", [200]);
    const status = str(rec(rec(readJson(res.body, "neon operation"), "neon operation").operation, "neon operation").status, "neon operation");
    if (status === "finished") return;
    if (status === "failed" || status === "error" || status === "cancelled" || attempt === 29) throw new Error("branch operation failed");
    await io.sleep(); } }
async function createBranch(io: Io, neon: NeonAuth, name: string, parentId: string): Promise<BranchRecord> {
  const url = projectUrl(neon.project, "/branches");
  const res = await call(io, "POST", url, neon.key, "json", [], { branch: { name, parent_id: parentId }, endpoints: [{ type: "read_write" }] });
  if (isLimit(res.status, res.body)) throw new Error("database copies full");
  if (res.status !== 200 && res.status !== 201) throw httpFail("POST", url, res.status, res.body);
  const row = rec(readJson(res.body, "neon create"), "neon create");
  if (row.operations !== undefined && !Array.isArray(row.operations)) throw new Error("neon create");
  const operations = Array.isArray(row.operations) ? row.operations.map((item) => str(rec(item, "neon create").id, "neon create")) : [];
  const branch = parseBranch(row.branch);
  if (branch.name !== name || branch.parentId !== parentId) { if (deletable(branch)) await deleteBranch(io, neon, branch); throw new Error("parent is not dev"); }
  for (const operation of operations) await waitOperation(io, neon, operation);
  return branch; }
function acceptUri(uri: string): string { if (!PG_URL.test(uri)) throw new Error("refusing connection uri"); return uri; }
async function connectionUri(io: Io, neon: NeonAuth, branchId: string, pooled: boolean): Promise<string> {
  const query = new URLSearchParams({ branch_id: branchId, database_name: "neondb", role_name: "neondb_owner", pooled: pooled ? "true" : "false" });
  const res = await call(io, "GET", `${projectUrl(neon.project, "/connection_uri")}?${query}`, neon.key, "get", [200]);
  return acceptUri(str(rec(readJson(res.body, "connection uri"), "connection uri").uri, "connection uri")); }
function mask(io: Io, uris: readonly string[]): void { const seen = new Set<string>(); for (const uri of uris) { if (seen.has(uri)) continue; seen.add(uri); io.stdout(`::add-mask::${uri}\n`); } }
function siteUrl(pathName: string, site: string): string { return `${NETLIFY}${pathName}?site_id=${encodeURIComponent(site)}`; }
async function accountId(io: Io, netlify: NetlifyAuth): Promise<string> {
  const res = await call(io, "GET", `${NETLIFY}/sites/${encodeURIComponent(netlify.site)}`, netlify.token, "get", [200]);
  const row = rec(readJson(res.body, "netlify site"), "netlify site");
  const id = strOpt(row.account_id, "netlify site") || strOpt(row.account_slug, "netlify site");
  if (id === undefined || id === "") throw new Error("netlify account");
  return id; }
function parseValues(body: string): EnvValue[] {
  const values = rec(readJson(body, "netlify env"), "netlify env").values;
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error("netlify env");
  return values.map((item) => { const row = rec(item, "netlify env"); return { id: str(row.id, "netlify env"), context: str(row.context, "netlify env"), contextParameter: strOpt(row.context_parameter, "netlify env") ?? "" }; }); }
async function readEnv(io: Io, netlify: NetlifyAuth, account: string, key: string): Promise<{ kind: "absent" } | { kind: "present"; values: readonly EnvValue[] }> {
  const res = await call(io, "GET", siteUrl(`/accounts/${encodeURIComponent(account)}/env/${encodeURIComponent(key)}`, netlify.site), netlify.token, "get", [200, 404]);
  return res.status === 404 ? { kind: "absent" } : { kind: "present", values: parseValues(res.body) }; }
async function putBranchEnv(io: Io, netlify: NetlifyAuth, ref: string, key: string, secret: boolean, value: string): Promise<void> {
  const account = await accountId(io, netlify);
  const current = await readEnv(io, netlify, account, key);
  const branch = { value, context: "branch", context_parameter: ref };
  if (current.kind === "absent") {
    const created = { key, is_secret: secret, values: [branch], ...(secret ? { scopes: ["builds", "functions", "runtime"] } : {}) };
    const url = siteUrl(`/accounts/${encodeURIComponent(account)}/env`, netlify.site);
    const res = await call(io, "POST", url, netlify.token, "json", [200, 201, 422], [created]);
    if (res.status === 200 || res.status === 201) return;
    if (!/already exists/i.test(jsonMessage(res.body))) throw httpFail("POST", url, res.status, res.body); }
  await call(io, "PATCH", siteUrl(`/accounts/${encodeURIComponent(account)}/env/${encodeURIComponent(key)}`, netlify.site), netlify.token, "json", [200, 201, 204], { context: "branch", context_parameter: ref, value }); }
async function deleteBranchEnv(io: Io, netlify: NetlifyAuth, ref: string, branchName: string): Promise<void> {
  const account = await accountId(io, netlify);
  for (const key of ["DATABASE_URL", "APP_DB_LABEL"]) {
    const current = await readEnv(io, netlify, account, key);
    if (current.kind === "absent") continue;
    const value = current.values.find((item) => item.context === "branch" && item.contextParameter === ref);
    if (value === undefined) continue;
    await call(io, "DELETE", siteUrl(`/accounts/${encodeURIComponent(account)}/env/${encodeURIComponent(key)}/value/${encodeURIComponent(value.id)}`, netlify.site), netlify.token, "get", [200, 204, 404]);
    prove(io, `${branchName} removed ${key}`, []); } }
type ListedDeploy = { readonly id: string; readonly context: string; readonly branch: string; readonly reviewId: number | undefined; readonly urls: readonly string[] };
function reviewIdOf(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("netlify deploy");
  return value >= 1 ? value : undefined; }
function urlList(row: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of ["ssl_url", "url", "deploy_ssl_url", "review_url"]) {
    const value = strOpt(row[key], "netlify deploy");
    if (value !== undefined && value !== "") urls.push(value); }
  return urls; }
function parseDeploys(body: string): ListedDeploy[] {
  const data = readJson(body, "netlify deploys");
  if (!Array.isArray(data)) throw new Error("netlify deploys");
  return data.map((item) => {
    const row = rec(item, "netlify deploy");
    return { id: str(row.id, "netlify deploy"), context: strOpt(row.context, "netlify deploy") ?? "", branch: strOpt(row.branch, "netlify deploy") ?? "", reviewId: reviewIdOf(row.review_id), urls: urlList(row) }; }); }
function namesPreview(deploy: ListedDeploy, pr: number, ref: string): boolean {
  if (deploy.context !== "deploy-preview") return false;
  if (deploy.reviewId !== undefined) return deploy.reviewId === pr;
  if (deploy.branch === ref) return true;
  return deploy.urls.some((url) => url.includes(`deploy-preview-${pr}--`)); }
async function rebuild(io: Io, netlify: NetlifyAuth, pr: number, ref: string): Promise<void> {
  const query = new URLSearchParams({ "deploy-previews": "true", per_page: "100" });
  let url: string | undefined = `${NETLIFY}/sites/${encodeURIComponent(netlify.site)}/deploys?${query}`;
  const seen = new Set<string>();
  while (url !== undefined && !seen.has(url)) {
    seen.add(url);
    const res = await call(io, "GET", url, netlify.token, "get", [200]);
    const id = parseDeploys(res.body).find((deploy) => namesPreview(deploy, pr, ref))?.id;
    if (id !== undefined) {
      await call(io, "POST", `${NETLIFY}/deploys/${encodeURIComponent(id)}/retry`, netlify.token, "get", [200, 201]);
      return; }
    const next = nextLink(res.link);
    url = next !== undefined && next.startsWith(`${NETLIFY}/`) ? next : undefined; }
  throw new Error("preview deploy missing"); }
function nextLink(link: string | null): string | undefined {
  if (link === null || link === "") return undefined;
  for (const part of link.split(",")) { const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part); if (match?.[1] !== undefined) return match[1]; }
  return undefined; }
function parseFiles(body: string): GhFile[] {
  const data = readJson(body, "github files");
  if (!Array.isArray(data)) throw new Error("github files");
  return data.map((item) => { const row = rec(item, "github file"); return { filename: str(row.filename, "github file"), status: str(row.status, "github file"), previousFilename: strOpt(row.previous_filename, "github file"), contentsUrl: strOpt(row.contents_url, "github file") }; }); }
function pathsOf(files: readonly GhFile[]): string[] { const paths: string[] = []; for (const file of files) { paths.push(file.filename); if (file.previousFilename !== undefined) paths.push(file.previousFilename); } return paths; }
function repoUrl(github: GitHubAuth, suffix: string): string { return `${GITHUB}/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}${suffix}`; }
async function githubFiles(io: Io, github: GitHubAuth, pr: number): Promise<GhFile[]> {
  const files: GhFile[] = [];
  let url: string | undefined = `${repoUrl(github, `/pulls/${pr}/files`)}?per_page=100`;
  const seen = new Set<string>();
  while (url !== undefined && !seen.has(url)) {
    seen.add(url);
    const res = await call(io, "GET", url, github.token, "github", [200]);
    files.push(...parseFiles(res.body));
    const next = nextLink(res.link);
    url = next !== undefined && next.startsWith(`${GITHUB}/`) ? next : undefined; }
  return files; }
async function githubPull(io: Io, github: GitHubAuth, pr: number): Promise<{ kind: "open" | "closed"; ref: string } | { kind: "missing" }> {
  const res = await call(io, "GET", repoUrl(github, `/pulls/${pr}`), github.token, "github", [200, 404]);
  if (res.status === 404) return { kind: "missing" };
  const row = rec(readJson(res.body, "github pull"), "github pull");
  const state = str(row.state, "github pull");
  const ref = str(rec(row.head, "github pull").ref, "github pull");
  if (state !== "open" && state !== "closed") throw new Error("github pull");
  return state === "open" ? { kind: "open", ref } : { kind: "closed", ref }; }
function rawUrl(file: GhFile, sha: string): string {
  if (file.contentsUrl === undefined) throw new Error("github contents");
  let url: URL;
  try { url = new URL(file.contentsUrl); } catch { throw new Error("github contents"); }
  if (url.origin !== GITHUB) throw new Error("github contents");
  url.searchParams.set("ref", sha);
  return url.href; }
async function withSql(io: Io, github: GitHubAuth, files: readonly GhFile[], sha: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "db-copy-"));
  try {
    for (const file of files) {
      if (file.status === "removed" || !SQL_FILE.test(file.filename)) continue;
      const res = await call(io, "GET", rawUrl(file, sha), github.token, "raw", [200]);
      writeFileSync(path.join(dir, path.basename(file.filename)), res.body); }
    await run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); } }
async function migrateDir(io: Io, databaseUrl: string, dir: string, secrets: readonly string[]): Promise<void> {
  try {
    const result = await io.migrate(databaseUrl, dir);
    for (const name of appliedNames(result)) prove(io, name, secrets);
  } catch (error) { throw new Error(redact(error instanceof Error ? error.message : "migrate failed", secrets)); } }
async function provision(io: Io, plan: { pr: number; name: string }, github: GitHubAuth, files: readonly GhFile[], sha: string, ref: string): Promise<void> {
  const neon = neonAuth(io.env);
  const netlify = netlifyAuth(io.env);
  const branches = await listBranches(io, neon);
  const decision = ensureDecision(plan.name, branches);
  let branch: BranchRecord;
  switch (decision.kind) {
    case "stop": throw new Error(decision.reason);
    case "full": throw new Error("database copies full");
    case "reuse": branch = decision.branch; break;
    case "create": branch = await createBranch(io, neon, plan.name, decision.parentId); break;
    default: return unexpected(decision); }
  const parent = branches.find((item) => item.id === branch.parentId);
  if (parent !== undefined) prove(io, `provision ${branch.name} parent ${parent.name}`, []);
  const direct = await connectionUri(io, neon, branch.id, false);
  const pooled = await connectionUri(io, neon, branch.id, true);
  mask(io, [direct, pooled]);
  await withSql(io, github, files, sha, (dir) => migrateDir(io, direct, dir, [direct, pooled]));
  await putBranchEnv(io, netlify, ref, "DATABASE_URL", true, pooled);
  await putBranchEnv(io, netlify, ref, "APP_DB_LABEL", false, plan.name);
  await rebuild(io, netlify, plan.pr, ref); }
async function runCopy(io: Io): Promise<number> {
  if (refuseFork(io)) return 1;
  const pr = prNumber(need(io.env, "PR_NUMBER"));
  const github = githubAuth(io.env);
  const files = await githubFiles(io, github, pr);
  const plan = planCopy(pr, pathsOf(files));
  if (plan.kind === "skip") return 0;
  await provision(io, plan, github, files, need(io.env, "HEAD_SHA"), need(io.env, "HEAD_REF"));
  return 0; }
async function runClose(io: Io): Promise<number> {
  if (refuseFork(io)) return 1;
  const pr = prNumber(need(io.env, "PR_NUMBER"));
  const ref = need(io.env, "HEAD_REF");
  const neon = neonAuth(io.env);
  const name = `preview/pr-${pr}`;
  for (const branch of await listBranches(io, neon)) if (branch.name === name) await deleteBranch(io, neon, branch);
  await deleteBranchEnv(io, netlifyAuth(io.env), ref, name);
  return 0; }
async function runSweep(io: Io): Promise<number> {
  const github = githubAuth(io.env);
  const neon = neonAuth(io.env);
  const netlify = netlifyAuth(io.env);
  for (const branch of await listBranches(io, neon)) {
    const pr = previewPr(branch.name);
    if (pr === undefined) continue;
    const pull = await githubPull(io, github, pr);
    const action = planSweep(pull.kind);
    switch (action.kind) {
      case "keep": continue;
      case "delete":
        if (pull.kind !== "closed") throw new Error("sweep");
        await deleteBranch(io, neon, branch);
        prove(io, `sweep ${branch.name}`, []);
        await deleteBranchEnv(io, netlify, pull.ref, branch.name);
        break;
      default: return unexpected(action); } }
  return 0; }
function changedPaths(env: NodeJS.ProcessEnv, cwd: string): readonly string[] | "unknown" {
  if (env.CHANGED_PATHS !== undefined) return env.CHANGED_PATHS.replaceAll("\r", "").split("\n").filter((item) => item.length > 0);
  const before = env.EVENT_BEFORE;
  const sha = env.EVENT_SHA;
  if (before === undefined || sha === undefined || !SHA.test(before) || !SHA.test(sha) || before === "0".repeat(40)) return "unknown";
  const result = spawnSync("git", ["diff", "--name-only", before, sha], { cwd, encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return "unknown";
  return result.stdout.split("\n").filter((item) => item.length > 0); }
function repoDbDir(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db"); }
async function runDevMigrate(io: Io): Promise<number> {
  if (planDevMigrate(changedPaths(io.env, io.cwd)).kind === "skip") return 0;
  const databaseUrl = acceptUri(need(io.env, "APP_DEV_DATABASE_URL"));
  io.stdout(`::add-mask::${databaseUrl}\n`);
  await migrateDir(io, databaseUrl, repoDbDir(), [databaseUrl]);
  return 0; }
function secretValues(env: NodeJS.ProcessEnv): string[] {
  const values: string[] = [];
  for (const name of ["NEON_API_KEY", "NETLIFY_AUTH_TOKEN", "GITHUB_TOKEN", "APP_DEV_DATABASE_URL"]) {
    const value = env[name];
    if (value !== undefined && value.length >= 12) values.push(value); }
  return values; }
export async function execute(command: string, io: Io): Promise<number> {
  try {
    switch (command) {
      case "copy": return await runCopy(io);
      case "close": return await runClose(io);
      case "sweep": return await runSweep(io);
      case "dev-migrate": return await runDevMigrate(io);
      default: io.stderr("unknown command\n"); return 1; }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    io.stderr(`${message === "database copies full" ? message : redact(message, secretValues(io.env))}\n`);
    return 1; } }
async function fetchHttp(input: HttpInput): Promise<HttpResult> {
  const response = await globalThis.fetch(input.url, { method: input.method, headers: input.headers, body: input.body });
  return { status: response.status, body: await response.text(), link: response.headers.get("link") }; }
function isDirectRun(): boolean { const entry = process.argv[1]; return entry !== undefined && import.meta.url === pathToFileURL(entry).href; }
async function main(): Promise<void> {
  try {
    process.exit(await execute(process.argv[2] ?? "", {
      env: process.env, cwd: process.cwd(), http: fetchHttp, migrate: applyMigrations,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1000)),
      stdout: (line) => { process.stdout.write(line); }, stderr: (line) => { process.stderr.write(line); },
    }));
  } catch (error: unknown) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : "failed", secretValues(process.env))}\n`);
    process.exit(1); } }
if (isDirectRun()) void main();

#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { driveFeature, passwordsPresent, scrub } from "./sign-in.mjs";

const ROOT = "/tmp/verify-app";
const MAIN = "https://main--portal-starter.netlify.app/portal-starter/";
const AUTH_TEST = "https://auth-test--portal-starter.netlify.app/portal-starter/";
const PREVIEW = "https://deploy-preview-5--portal-starter.netlify.app/portal-starter/";
const LOGINS = ["login", "sso", "signup", "access"];

function say(line) {
  process.stdout.write(`${line}\n`);
}
function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function classifyTarget(raw) {
  const parsed = parseUrl(raw);
  const pathOk = parsed !== null && (parsed.pathname === "/portal-starter" || parsed.pathname === "/portal-starter/");
  if (parsed === null || parsed.protocol !== "https:" || parsed.search !== "" || parsed.hash !== "" || !pathOk) {
    return { kind: "rejected-host", url: raw };
  }
  const url = `https://${parsed.hostname}/portal-starter/`;
  if (parsed.hostname === "main--portal-starter.netlify.app") return { kind: "main", url };
  if (parsed.hostname === "auth-test--portal-starter.netlify.app") return { kind: "auth-test", url };
  const preview = /^deploy-preview-([1-9]\d*)--portal-starter\.netlify\.app$/.exec(parsed.hostname);
  if (preview) return { kind: "preview", pr: Number(preview[1]), url };
  return { kind: "rejected-host", url: raw };
}
function loginPattern(raw) {
  const parsed = parseUrl(raw);
  if (parsed === null || parsed.protocol !== "https:" || parsed.hostname !== "app.netlify.com") return "";
  const name = LOGINS.find((item) => parsed.pathname === `/${item}` || parsed.pathname.startsWith(`/${item}/`));
  return name ? `app.netlify.com/${name}` : "";
}
function classifyPage(status, finalUrl) {
  const pattern = loginPattern(finalUrl);
  if (pattern) return { kind: "netlify-login", pattern, finalUrl, status };
  if (status === 401) return { kind: "netlify-login", pattern: "status-401", finalUrl, status };
  const target = classifyTarget(finalUrl);
  if (target.kind === "rejected-host") return { kind: "rejected-host", finalUrl, status };
  if (status !== 200) return { kind: "http-error", finalUrl, status };
  return { kind: "app", finalUrl: target.url, status };
}
async function patternReport() {
  const raw = await readFile(new URL("./patterns.md", import.meta.url), "utf8");
  const lines = [`confirmed main ${MAIN}`, `confirmed preview ${PREVIEW}`];
  const errors = [];
  let mode = "";
  for (const row of raw.split("\n")) {
    if (row === "" || row === "# URL patterns") continue;
    if (row === "# target" || row === "# login" || row === "# page") {
      mode = row.slice(2);
      continue;
    }
    const [name, a, b, c] = row.split(" ");
    const actual = mode === "target" ? classifyTarget(a).kind : mode === "login" ? loginPattern(a) : classifyPage(Number(a), b).kind;
    const expected = mode === "page" ? c : b;
    lines.push(`pattern ${name} ${actual}`);
    if (actual !== expected) errors.push(`pattern mismatch ${name} expected ${expected}`);
  }
  return { lines, errors };
}
function emitReport(report) {
  for (const line of report.lines) say(line);
  for (const line of report.errors) process.stderr.write(`${line}\n`);
  return report.errors.length === 0;
}
function stopLine(page) {
  if (page.kind === "netlify-login") {
    return `Netlify login page. Stop. Matched ${page.pattern} at ${page.finalUrl}. Do not type a password.`;
  }
  if (page.kind === "rejected-host") {
    return `Refusing ${page.finalUrl}. Use main--portal-starter.netlify.app or deploy-preview-<pr>--portal-starter.netlify.app at /portal-starter/.`;
  }
  if (page.kind === "http-error") return `HTTP ${page.status} at ${page.finalUrl}.`;
  return "doctor failed";
}

function helloOk(html) {
  const take = (pattern) => {
    const match = pattern.exec(html);
    return match ? match[1] : "";
  };
  return take(/<title>([^<]*)<\/title>/i) === "Portal Starter"
    && take(/<h1>([^<]*)<\/h1>/i) === "Hello"
    && take(/<link rel="stylesheet" href="([^"]+)">/i) === "tokens.css";
}

const DEV_BANNER = "DEV/preview environment. Test data only.";
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

function bannerGaps(html) {
  const gaps = [];
  if (!html.includes(DEV_BANNER)) gaps.push(`dev banner "${DEV_BANNER}"`);
  if (!html.includes(ROBOTS_META)) gaps.push("noindex, nofollow");
  return gaps;
}

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    throw new Error(`Fetch failed for ${url}. ${message}`);
  }
  return {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

async function fetchPage(url) {
  const target = classifyTarget(url);
  if (target.kind === "rejected-host") throw new Error(`Refusing to fetch ${url}`);
  return fetchText(target.url);
}

async function fetchTokens(pageUrl) {
  const page = classifyTarget(pageUrl);
  if (page.kind === "rejected-host") throw new Error(`Refusing stylesheet for ${pageUrl}`);
  const href = `https://${new URL(page.url).hostname}/portal-starter/tokens.css`;
  const style = await fetchText(href);
  const classified = classifyPage(style.status, style.finalUrl);
  if (classified.kind === "netlify-login") throw new Error(stopLine(classified));
  if (style.status !== 200 || !style.contentType.includes("text/css") || !style.body.includes("--bg-deep")) {
    throw new Error("tokens.css did not return the Portal Starter tokens");
  }
  return style.status;
}

function readArgs(argv) {
  const out = { target: "", pr: "", feature: "hello-page", runId: "" };
  for (let i = 3; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--target") out.target = value;
    else if (flag === "--pr") out.pr = value;
    else if (flag === "--feature") out.feature = value;
    else if (flag === "--run-id") out.runId = value;
    else throw new Error(`Unknown flag ${flag}`);
    i += 1;
  }
  return out;
}

function targetUrl(args) {
  if (args.target === "main") return MAIN;
  if (args.target === "auth-test") return AUTH_TEST;
  if (args.target !== "preview") throw new Error("Target must be main, auth-test, or preview");
  if (!/^[1-9]\d*$/.test(args.pr)) throw new Error("Preview target needs --pr with a positive integer");
  return `https://deploy-preview-${args.pr}--portal-starter.netlify.app/portal-starter/`;
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${stamp}-${process.pid}`;
}

function runPaths(runId) {
  if (!/^[0-9]{8}T[0-9]{6}Z-\d+$/.test(runId)) throw new Error(`Refusing run id ${runId}`);
  const dir = path.join(ROOT, runId);
  return { runId, dir, evidenceDir: path.join(dir, "evidence"), profileDir: path.join(dir, "profile") };
}

async function launch(args) {
  const target = classifyTarget(targetUrl(args));
  if (target.kind === "rejected-host") throw new Error(`Refusing ${targetUrl(args)}`);
  const run = { ...runPaths(args.runId || newRunId()), url: target.url };
  await mkdir(run.evidenceDir, { recursive: true });
  await mkdir(run.profileDir, { recursive: true });
  await writeFile(path.join(run.dir, "run.json"), `${JSON.stringify({ runId: run.runId, url: run.url })}\n`);
  say(`launch ${run.runId} ${run.url}`);
  return run;
}

async function loadRun(runId) {
  const run = runPaths(runId);
  const record = JSON.parse(await readFile(path.join(run.dir, "run.json"), "utf8"));
  return { ...run, url: record.url };
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function cmdline(pid) {
  try {
    return (await readFile(`/proc/${pid}/cmdline`)).toString("utf8");
  } catch {
    return "";
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stopStarted(pid, profileDir) {
  const matches = async () => (await cmdline(pid)).includes(profileDir);
  if (!(await matches())) return;
  const signal = (name) => {
    try {
      process.kill(-pid, name);
    } catch {
      try {
        process.kill(pid, name);
      } catch {
        return;
      }
    }
  };
  signal("SIGTERM");
  for (let i = 0; i < 20; i += 1) {
    await delay(100);
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
  if (await matches()) signal("SIGKILL");
}

async function isPng(filePath) {
  try {
    const buf = await readFile(filePath);
    return buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  } catch {
    return false;
  }
}

async function capture(url, pngPath, profileDir, pidPath) {
  await mkdir(profileDir, { recursive: true });
  const child = spawn("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`,
    "--window-size=1280,800", "--hide-scrollbars", "--virtual-time-budget=4000", url,
  ], { stdio: "ignore", detached: true });
  child.unref();
  if (child.pid === undefined) throw new Error("google-chrome did not start");
  await writeFile(pidPath, `${child.pid}\n`);
  let png = false;
  try {
    for (let i = 0; i < 80; i += 1) {
      await delay(250);
      png = await isPng(pngPath);
      if (png) break;
    }
  } finally {
    await stopStarted(child.pid, profileDir);
    await rm(pidPath, { force: true });
  }
  if (!png) throw new Error("google-chrome did not write a PNG screenshot");
}

async function cleanupRun(runId) {
  let run;
  try {
    run = await loadRun(runId);
  } catch {
    say(`cleanup ${runId} already clean`);
    return;
  }
  const pidPath = path.join(run.dir, "chrome.pid");
  let pidText = "";
  try {
    pidText = await readFile(pidPath, "utf8");
  } catch {
    pidText = "";
  }
  const pid = Number(pidText);
  if (Number.isInteger(pid) && pid > 0) await stopStarted(pid, run.profileDir);
  let hadProfile = false;
  try {
    await stat(run.profileDir);
    hadProfile = true;
  } catch {
    hadProfile = false;
  }
  await rm(run.profileDir, { recursive: true, force: true });
  await rm(pidPath, { force: true });
  say(hadProfile || pidText !== "" ? `cleanup ${runId} profile removed` : `cleanup ${runId} already clean`);
}

async function doctor(run) {
  const report = await patternReport();
  const lines = [...report.lines];
  const save = async () => writeFile(path.join(run.evidenceDir, "doctor.txt"), `${lines.join("\n")}\n`);
  emitReport(report);
  if (report.errors.length > 0) {
    process.exitCode = 1;
    await save();
    return false;
  }
  const fetched = await fetchPage(run.url);
  const page = classifyPage(fetched.status, fetched.finalUrl);
  lines.push(`live ${page.finalUrl} ${page.status} ${page.kind}`);
  say(lines[lines.length - 1]);
  if (page.kind !== "app" || !helloOk(fetched.body)) {
    lines.push(page.kind === "app"
      ? "Expected title Portal Starter, heading Hello, and stylesheet tokens.css."
      : stopLine(page));
    say(lines[lines.length - 1]);
    process.exitCode = 1;
    await save();
    return false;
  }
  lines.push("hello title Portal Starter heading Hello stylesheet tokens.css");
  say(lines[lines.length - 1]);
  const gaps = bannerGaps(fetched.body);
  if (gaps.length > 0) {
    lines.push(`Missing ${gaps.join(" and ")}.`);
    say(lines[lines.length - 1]);
    process.exitCode = 1;
    await save();
    return false;
  }
  lines.push(`dev banner ${DEV_BANNER} noindex, nofollow`);
  say(lines[lines.length - 1]);
  await save();
  return true;
}

async function driveHello(run) {
  const page = await fetchPage(run.url);
  const classified = classifyPage(page.status, page.finalUrl);
  if (classified.kind !== "app" || !helloOk(page.body)) {
    throw new Error(classified.kind === "app" ? "Hello page text changed" : stopLine(classified));
  }
  const gaps = bannerGaps(page.body);
  if (gaps.length > 0) throw new Error(`Missing ${gaps.join(" and ")}.`);
  const tokens = await fetchTokens(classified.finalUrl);
  const pngPath = path.join(run.evidenceDir, "hello.png");
  await capture(classified.finalUrl, pngPath, run.profileDir, path.join(run.dir, "chrome.pid"));
  const driveLine = `drive hello-page ${classified.finalUrl} png ${await fileSize(pngPath)} tokens ${tokens}`;
  say(driveLine);
  await writeFile(path.join(run.evidenceDir, "drive.txt"), `${driveLine}\n`);
  return pngPath;
}

async function runAll(args) {
  const run = await launch(args);
  let png = "";
  try {
    if (!(await doctor(run))) return;
    png = await driveHello(run);
    say(`evidence ${png} ${await fileSize(png)}`);
  } finally {
    await cleanupRun(run.runId);
    const kept = png || path.join(run.evidenceDir, "hello.png");
    const size = await fileSize(kept);
    say(`evidence kept ${kept} ${size}`);
    if (!process.exitCode && size <= 1000) {
      process.stderr.write(`evidence missing after cleanup ${kept}\n`);
      process.exitCode = 1;
    }
  }
}

function stub(feature) {
  if (feature === "hello-page") {
    throw new Error("Feature hello-page is built. Use run --target main or run --target preview --pr <number>.");
  }
  throw new Error(`Unknown feature ${feature}`);
}

function signInFeature(feature) {
  return feature === "staff-sign-in" || feature === "users";
}

async function main() {
  const command = process.argv[2];
  if (command === "patterns") {
    if (!emitReport(await patternReport())) process.exitCode = 1;
    return;
  }
  const args = readArgs(process.argv);
  if (args.target === "") args.target = command === "drive" && signInFeature(args.feature) ? "auth-test" : "main";
  if (command === "launch") return launch(args);
  if (command === "doctor") return doctor(args.runId ? await loadRun(args.runId) : await launch(args));
  if (command === "drive") {
    if (!signInFeature(args.feature)) return stub(args.feature);
    if (!passwordsPresent(args.feature)) {
      say("test password secret missing");
      process.exitCode = 2;
      return;
    }
    const run = args.runId ? await loadRun(args.runId) : await launch(args);
    try {
      await driveFeature({
        feature: args.feature,
        kind: classifyTarget(run.url).kind,
        origin: new URL(run.url).origin,
        evidenceDir: run.evidenceDir,
        profileDir: run.profileDir,
        pidPath: path.join(run.dir, "chrome.pid"),
        say,
      });
    } finally {
      await cleanupRun(run.runId);
    }
    return;
  }
  if (command === "evidence") {
    if (!args.runId) throw new Error("evidence needs --run-id");
    const run = await loadRun(args.runId);
    const png = path.join(run.evidenceDir, "hello.png");
    say(`evidence ${png} ${await fileSize(png)}`);
    return;
  }
  if (command === "cleanup") {
    if (!args.runId) throw new Error("cleanup needs --run-id");
    await cleanupRun(args.runId);
    return;
  }
  if (command === "run") return runAll(args);
  throw new Error("Command must be patterns, launch, doctor, drive, evidence, cleanup, or run");
}

try {
  await main();
} catch (error) {
  const message = scrub(error instanceof Error ? error.message : "failed");
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

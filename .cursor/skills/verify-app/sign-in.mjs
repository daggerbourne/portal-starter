import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const HOST_SUFFIXES = [".microsoftonline.com", ".microsoft.com", ".live.com", ".msauth.net", ".msftauth.net", ".msidentity.com"];
const SECRET_ENV = ["APP_TEST_STAFF_EMAIL", "APP_TEST_NOSTAFF_EMAIL", "APP_TEST_STAFF_PASSWORD", "APP_TEST_NOSTAFF_PASSWORD", "APP_TEST_STAFF_TOTP", "APP_TEST_NOSTAFF_TOTP"];
const ACCOUNTS = [
  { id: "staff", emailEnv: "APP_TEST_STAFF_EMAIL", passwordEnv: "APP_TEST_STAFF_PASSWORD", totpEnv: "APP_TEST_STAFF_TOTP", expect: "users", shot: "staff-users.png" },
  { id: "nostaff", emailEnv: "APP_TEST_NOSTAFF_EMAIL", passwordEnv: "APP_TEST_NOSTAFF_PASSWORD", totpEnv: "APP_TEST_NOSTAFF_TOTP", expect: "forbidden", shot: "nostaff-forbidden.png" },
];
const LOOK = `(() => {
  const text = document.body ? document.body.innerText : "";
  const area = (sel) => { const el = document.querySelector(sel); if (!el) return 0; for (let node = el; node; node = node.parentElement) { const style = getComputedStyle(node); if (style.display === "none" || style.visibility === "hidden") return 0; } const box = el.getBoundingClientRect(); if (box.width < 40 || box.height < 16 || box.bottom < 0 || box.top > window.innerHeight) return 0; return box.width * box.height; };
  const heading = (document.querySelector("h1")?.textContent || "").trim();
  if (text.includes("sign-in isn't available on previews")) return "unavailable";
  if (heading === "Users") return "users"; if (text.trim() === "forbidden") return "forbidden"; if (heading === "Hello") return "hello";
  if (/couldn.t find an account|password is incorrect|code is incorrect|didn.t enter the expected/i.test(text)) return "rejected";
  if (area('input[name="otc"]') || area("#idTxtBx_SAOTCC_OTC")) return "code";
  if (area('input[name="passwd"]')) return "password"; if (area('input[name="loginfmt"]')) return "email";
  if (/more information required|keep your account secure/i.test(text)) return "proof-up";
  if (text.includes("Stay signed in")) return "stay"; if (text.includes("Permissions requested")) return "consent";
  if (/verification code/i.test(text)) return "use-code"; if (/sign in another way|can.t use my/i.test(text)) return "other-way";
  if (text.includes("Pick an account")) return "pick"; if (location.hostname.endsWith("netlify.app")) return "app";
  return "wait";
})()`;
const STATS = `(() => {
  return { heading: (document.querySelector("h1")?.textContent || "").trim(), rows: document.querySelectorAll("tbody tr").length, empty: document.querySelectorAll("p.empty").length };
})()`;
const CLICK = { stay: ["#idBtn_Back", ""], consent: ["", "/^Accept$/"], "use-code": ["", "/verification code/i"], "other-way": ["", "/sign in another way|I can't use/i"], pick: ["", "/use another account/i"] };
const hidden = [];

export function passwordsPresent(feature) {
  return (feature === "users" ? ["APP_TEST_STAFF_EMAIL", "APP_TEST_STAFF_PASSWORD"] : ["APP_TEST_STAFF_EMAIL", "APP_TEST_STAFF_PASSWORD", "APP_TEST_NOSTAFF_EMAIL", "APP_TEST_NOSTAFF_PASSWORD"]).every((name) => typeof process.env[name] === "string" && process.env[name] !== "");
}

export function scrub(text) {
  let out = String(text);
  for (const name of SECRET_ENV) { const value = process.env[name]; if (typeof value === "string" && value.length > 0) out = out.split(value).join("[redacted]"); }
  for (const value of hidden) if (value) out = out.split(value).join("[redacted]");
  return out;
}

function delay(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

function childEnv() { const env = { ...process.env }; for (const name of SECRET_ENV) delete env[name]; return env; }

function hostOk(hostname, originHost) {
  return hostname === originHost || hostname === "" || HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
}

function secret(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "") throw new Error(name.endsWith("_TOTP") ? "test totp secret missing" : "test password secret missing");
  return value;
}

function base32(input) {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = B32.indexOf(char);
    if (idx < 0) throw new Error("test totp secret unreadable");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}

function totpCode(name, skew) {
  const key = base32(secret(name));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + skew));
  const mac = createHmac("sha1", key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  const code = String(binary % 1000000).padStart(6, "0");
  hidden.push(code);
  return code;
}

function kill(pid, name) {
  try { process.kill(pid, name); return true; } catch { return false; }
}

async function stopChrome(pid, profileDir) {
  let cmd = "";
  try { cmd = (await readFile(`/proc/${pid}/cmdline`)).toString("utf8"); } catch { cmd = ""; }
  if (!cmd.includes(profileDir)) return;
  if (!kill(-pid, "SIGTERM")) kill(pid, "SIGTERM");
  for (let i = 0; i < 20 && kill(pid, 0); i += 1) await delay(100);
  if (kill(pid, 0) && !kill(-pid, "SIGKILL")) kill(pid, "SIGKILL");
}

function cdp(ws) {
  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const job = msg.id ? pending.get(msg.id) : undefined;
    if (!job) return;
    pending.delete(msg.id);
    if (msg.error) job.reject(new Error("sign-in step failed")); else job.resolve(msg.result);
  });
  return (method, params) => new Promise((resolve, reject) => { next += 1; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
}

async function evalJson(send, expression) {
  try {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) return undefined;
    return result.result ? result.result.value : undefined;
  } catch { return undefined; }
}

async function readPort(file) {
  for (let i = 0; i < 50; i += 1) {
    try { const port = (await readFile(file, "utf8")).split("\n")[0].trim(); if (port) return port; } catch { await delay(0); }
    await delay(200);
  }
  throw new Error("google-chrome did not start");
}

async function ensureDisplay() {
  if (process.env.DISPLAY) return;
  process.env.DISPLAY = ":99";
  try { await readFile("/tmp/.X99-lock"); } catch { spawn("Xvfb", [":99", "-screen", "0", "1600x1200x24"], { stdio: "ignore", detached: true, env: childEnv() }).unref(); await delay(400); }
}

async function openChrome(profileDir, pidPath) {
  await mkdir(profileDir, { recursive: true });
  await ensureDisplay();
  const chrome = spawn("google-chrome", ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1600,1200", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore", detached: true, env: childEnv() });
  chrome.unref();
  if (chrome.pid === undefined) throw new Error("google-chrome did not start");
  await writeFile(pidPath, `${chrome.pid}\n`);
  const port = await readPort(path.join(profileDir, "DevToolsActivePort"));
  let page;
  for (let i = 0; i < 20 && !page; i += 1) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === "page"); } catch { page = undefined; }
    if (!page) await delay(200);
  }
  if (!page) throw new Error("google-chrome did not open a page");
  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("google-chrome did not open a page"))); });
  const send = cdp(ws);
  await send("Page.enable");
  await send("Runtime.enable");
  return { send, ws, pid: chrome.pid };
}

async function press(send, selector) {
  const ok = await evalJson(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error("sign-in step failed");
}

async function fill(send, selector, text, button) {
  const focused = await evalJson(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.value = ""; return document.activeElement === el; })()`);
  if (!focused) throw new Error("sign-in field missing");
  await send("Input.insertText", { text });
  const length = await evalJson(send, "(() => document.activeElement && document.activeElement.value ? document.activeElement.value.length : 0)()");
  if (length !== text.length) throw new Error("sign-in step failed");
  await press(send, button);
}

async function clickLabel(send, source) {
  const ok = await evalJson(send, `(() => { const node = [...document.querySelectorAll("a, button, input[type=submit], div[role=button], span[role=button]")].find((el) => ${source}.test((el.value || el.innerText || "").trim()) && el.getBoundingClientRect().width > 0); if (!node) return false; node.click(); return true; })()`);
  if (!ok) throw new Error("sign-in step failed");
}

async function shown(send, selectors) {
  for (const selector of selectors) {
    if (await evalJson(send, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const box = el.getBoundingClientRect(); return box.width >= 40 && box.height >= 16; })()`)) return selector;
  }
  return "";
}

async function waitScreen(send, originHost, held = "wait") {
  const start = Date.now();
  let screen = "wait";
  while (Date.now() - start < 20000) {
    const hostname = await evalJson(send, "(() => location.hostname)()");
    if (typeof hostname === "string" && !hostOk(hostname, originHost)) throw new Error(`Refusing host ${hostname}`);
    const next = await evalJson(send, LOOK);
    screen = typeof next === "string" ? next : "wait";
    if (screen !== "wait" && screen !== held) return screen;
    await delay(400);
  }
  return screen;
}

async function act(send, account, screen, tries) {
  if (screen === "email") return fill(send, 'input[name="loginfmt"]', secret(account.emailEnv), "#idSIButton9");
  if (screen === "password") return fill(send, 'input[name="passwd"]', secret(account.passwordEnv), "#idSIButton9");
  if (screen === "code") {
    const field = await shown(send, ['input[name="otc"]', "#idTxtBx_SAOTCC_OTC"]);
    const button = await shown(send, ["#idSubmit_SAOTCC_Continue", "#idSIButton9"]);
    if (!field || !button) throw new Error("sign-in stopped on code");
    return fill(send, field, totpCode(account.totpEnv, tries === 1 ? 0 : -1), button);
  }
  const click = CLICK[screen];
  if (!click) throw new Error(`sign-in stopped on ${screen}`);
  if (click[0]) return press(send, click[0]);
  return clickLabel(send, click[1]);
}

async function finishLogin(send, account, originHost, kind) {
  const seen = new Map();
  for (let step = 0, held = "wait"; step < 12; step += 1) {
    const screen = await waitScreen(send, originHost, held);
    if (screen === "unavailable" && kind === "preview") return "unavailable";
    if (screen === "unavailable") throw new Error("sign-in isn't available on this host");
    if (screen === "forbidden") return "forbidden";
    if (screen === "users" || screen === "hello" || screen === "app") return screen;
    if (screen === "proof-up") throw new Error("sign-in stopped on proof-up");
    const tries = (seen.get(screen) ?? 0) + 1;
    seen.set(screen, tries);
    if (tries > (screen === "email" || screen === "password" ? 1 : 2) || screen === "wait" || screen === "rejected") throw new Error(`sign-in stopped on ${screen}`);
    await act(send, account, screen, tries);
    held = screen;
  }
  throw new Error("sign-in stopped");
}

async function shoot(send, file) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const bytes = Buffer.from(shot.data, "base64");
  await writeFile(file, bytes);
  if (bytes.length <= 1000) throw new Error("screenshot missing");
  return bytes.length;
}

async function oneAccount(account, ctx) {
  const profileDir = path.join(ctx.profileDir, account.id);
  const session = await openChrome(profileDir, ctx.pidPath);
  try {
    const originHost = new URL(ctx.origin).hostname;
    await session.send("Page.navigate", { url: `${ctx.origin}/portal-starter/auth/login` });
    const landed = await finishLogin(session.send, account, originHost, ctx.kind);
    if (landed === "unavailable") return "sign-in isn't available on previews";
    if (account.expect === "forbidden") {
      if (landed !== "forbidden") throw new Error("non-staff reached the app");
      return `nostaff forbidden png ${await shoot(session.send, path.join(ctx.evidenceDir, account.shot))}`;
    }
    if (landed === "forbidden") throw new Error("staff was forbidden");
    if (landed !== "users") await session.send("Page.navigate", { url: `${ctx.origin}/portal-starter/admin` });
    if (landed !== "users" && await waitScreen(session.send, originHost, landed) !== "users") throw new Error("staff did not reach the users list");
    const stats = await evalJson(session.send, STATS);
    const size = await shoot(session.send, path.join(ctx.evidenceDir, account.shot));
    const rows = stats && typeof stats.rows === "number" ? stats.rows : 0, empty = stats && typeof stats.empty === "number" ? stats.empty : 0;
    if (!stats || stats.heading !== "Users" || rows + empty === 0) {
      throw new Error(`users list did not render rows ${rows} empty ${empty} png ${size}`);
    }
    return `staff users /portal-starter/admin rows ${rows} empty ${empty} png ${size}`;
  } finally {
    session.ws.close();
    await stopChrome(session.pid, profileDir);
  }
}

function stopForSecret(error, say) {
  const message = scrub(error instanceof Error ? error.message : "sign-in failed");
  if (message !== "test totp secret missing" && message !== "test password secret missing") throw new Error(message);
  say(message);
  process.exitCode = 2;
}

export async function driveFeature(ctx) {
  const accounts = ctx.feature === "users" ? [ACCOUNTS[0]] : ACCOUNTS;
  const lines = [];
  try {
    for (const account of accounts) {
      let line = "";
      try { line = await oneAccount(account, ctx); } catch (error) { stopForSecret(error, ctx.say); return; }
      lines.push(line);
      ctx.say(line);
      if (line === "sign-in isn't available on previews") return;
    }
  } finally {
    if (lines.length > 0) await writeFile(path.join(ctx.evidenceDir, "drive.txt"), `${lines.join("\n")}\n`);
  }
}

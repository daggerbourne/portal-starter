import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const ROBOTS = '<meta name="robots" content="noindex, nofollow">';
const STYLE = [
  "<style>",
  ".dev-banner { margin: 0; background: var(--dev-banner-bg); color: var(--dev-banner-text); font-weight: var(--fw-semibold); padding: var(--space-3) var(--space-4); }",
  "</style>",
].join("\n");
const CHARSET = '<meta charset="utf-8">';
const BODY = "<body>";

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function databaseLabel(env) {
  const value = env.APP_DB_LABEL;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function banner(label) {
  const sentence = "DEV/preview environment. Test data only.";
  const text = label === undefined ? sentence : `${sentence} ${escapeHtml(label)}`;
  return `<p class="dev-banner" role="status">${text}</p>`;
}

function stamp(html, label) {
  if (!html.includes(CHARSET) || !html.includes(BODY)) {
    throw new Error("hello.html has no place to put the dev banner");
  }
  return html.replace(CHARSET, `${CHARSET}\n${ROBOTS}\n${STYLE}`).replace(BODY, `${BODY}\n${banner(label)}`);
}

const production = process.env.CONTEXT === "production";
rmSync("dist.build", { recursive: true, force: true });
let published = false;
try {
  mkdirSync("dist.build/portal-starter", { recursive: true });
  const source = readFileSync("hello.html");
  writeFileSync(
    "dist.build/portal-starter/index.html",
    production ? source : stamp(source.toString("utf8"), databaseLabel(process.env)),
  );
  copyFileSync("design/tokens.css", "dist.build/portal-starter/tokens.css");
  rmSync("dist", { recursive: true, force: true });
  renameSync("dist.build", "dist");
  published = true;
} finally {
  if (!published) rmSync("dist.build", { recursive: true, force: true });
}

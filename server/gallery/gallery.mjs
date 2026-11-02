import { readdir } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let loaderPending;

function defaultUiRoot() {
  return fileURLToPath(new URL("../../ui/", import.meta.url));
}

function access(deployContext) {
  if (typeof deployContext !== "string") return "closed";
  const trimmed = deployContext.trim();
  if (trimmed === "" || trimmed === "production") return "closed";
  return "open";
}

function notFound() {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function html(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function ensureLoader() {
  if (loaderPending === undefined) {
    const loaderUrl = new URL("./gallery-loader.mjs", import.meta.url);
    loaderPending = Promise.resolve(
      register(loaderUrl, { parentURL: import.meta.url }),
    ).catch((error) => {
      loaderPending = undefined;
      throw error;
    });
  }
  return loaderPending;
}

async function findGalleryFiles(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error !== null && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".gallery.ts")) found.push(full);
    }
  }
  await walk(root);
  found.sort();
  return found;
}

function readEntry(value, relativePath) {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${relativePath} has no gallery entry`);
  }
  if (typeof value.name !== "string" || value.name === "") {
    throw new Error(`${relativePath} has no gallery name`);
  }
  if (typeof value.render !== "function") {
    throw new Error(`${relativePath} has no gallery render`);
  }
  if (!Object.hasOwn(value, "sample")) {
    throw new Error(`${relativePath} has no gallery sample`);
  }
  return value;
}

async function loadEntry(root, file) {
  const relativePath = path.relative(root, file).split(path.sep).join("/");
  const imported = await import(pathToFileURL(file).href);
  const entry = readEntry(imported.default, relativePath);
  const markup = entry.render(entry.sample);
  if (typeof markup !== "string") {
    throw new Error(`${relativePath} render did not return text`);
  }
  return { name: entry.name, relativePath, markup };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPage(entries) {
  const body =
    entries.length === 0
      ? "<p>No renders yet.</p>"
      : entries
          .map(
            (entry) => `<section>
<h2>${escapeHtml(entry.name)}</h2>
<p>${escapeHtml(entry.relativePath)}</p>
${entry.markup}
</section>`,
          )
          .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Portal Starter render gallery</title>
<link rel="stylesheet" href="/portal-starter/tokens.css">
<style>
body { margin: 0; font-family: var(--font-sans); background: var(--bg-deep); color: var(--text-primary); }
.dev-banner { margin: 0; background: var(--dev-banner-bg); color: var(--dev-banner-text); font-weight: var(--fw-semibold); padding: var(--space-3) var(--space-4); }
main { padding: var(--space-6); }
section { margin-bottom: var(--space-8); }
h1, h2 { font-weight: var(--fw-semibold); letter-spacing: var(--tracking-heading); }
</style>
</head>
<body>
<p class="dev-banner" role="status">DEV/preview environment. Test data only.</p>
<main>
<h1>Portal Starter render gallery</h1>
${body}
</main>
</body>
</html>
`;
}

export async function renderGallery({ deployContext, uiRoot }) {
  if (access(deployContext) === "closed") return notFound();
  const root = uiRoot ?? defaultUiRoot();
  const files = await findGalleryFiles(root);
  if (files.length > 0) await ensureLoader();
  const entries = [];
  for (const file of files) entries.push(await loadEntry(root, file));
  return html(renderPage(entries));
}

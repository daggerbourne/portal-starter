import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import gallery from "../../../server/functions/gallery/index.mjs";
import { renderGallery } from "../../../server/gallery/gallery.mjs";

const BANNER = "DEV/preview environment. Test data only.";
const ROBOTS = '<meta name="robots" content="noindex, nofollow">';
const TOKENS = '<link rel="stylesheet" href="/portal-starter/tokens.css">';

async function uiRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gallery-"));
  await mkdir(root, { recursive: true });
  return root;
}

async function writeUi(root: string, relativePath: string, source: string): Promise<void> {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
}

async function page(deployContext: string | undefined, root: string): Promise<Response> {
  return renderGallery({ deployContext, uiRoot: root });
}

test("dev lists every gallery file and shows its render with its sample", async () => {
  const root = await uiRoot();
  await writeUi(
    root,
    "widgets/mark.ts",
    `export function mark(label: string): string {
  return \`<em>\${label}</em>\`;
}
`,
  );
  await writeUi(
    root,
    "widgets/skip.ts",
    `throw new Error("plain ts was loaded");
`,
  );
  await writeUi(
    root,
    "widgets/badge.gallery.ts",
    `import { mark } from "./mark.js";

const sample = { label: "Lamp" };

export default {
  name: "Badge",
  sample,
  render(data: { label: string }): string {
    return mark(data.label);
  },
};
`,
  );
  await writeUi(
    root,
    "notes/note.gallery.ts",
    `const sample = { label: "Desk" };

export default {
  name: "Note",
  sample,
  render(data: { label: string }): string {
    return \`<p>\${data.label}</p>\`;
  },
};
`,
  );

  const response = await page("dev", root);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(body.includes(BANNER), true);
  assert.equal(body.includes(ROBOTS), true);
  assert.equal(body.includes(TOKENS), true);
  assert.equal(body.includes("<title>Portal Starter render gallery</title>"), true);
  assert.equal(body.includes("<em>Lamp</em>"), true);
  assert.equal(body.includes("Badge"), true);
  assert.equal(body.includes("<p>Desk</p>"), true);
  assert.equal(body.includes("Note"), true);
  assert.equal(body.includes("widgets/badge.gallery.ts"), true);
  assert.equal(body.includes("notes/note.gallery.ts"), true);
  assert.equal(body.includes("plain ts was loaded"), false);
  assert.equal(body.includes("skip.ts"), false);
});

test("a gallery file added after the first request shows up without a shared registry", async () => {
  const root = await uiRoot();
  await writeUi(
    root,
    "notes/note.gallery.ts",
    `export default {
  name: "Note",
  sample: { label: "Desk" },
  render(data: { label: string }): string {
    return \`<p>\${data.label}</p>\`;
  },
};
`,
  );

  const first = await page("dev", root);
  const firstBody = await first.text();
  assert.equal(firstBody.includes("<p>Desk</p>"), true);
  assert.equal(firstBody.includes("<em>Lamp</em>"), false);

  await writeUi(
    root,
    "widgets/mark.ts",
    `export function mark(label: string): string {
  return \`<em>\${label}</em>\`;
}
`,
  );
  await writeUi(
    root,
    "widgets/badge.gallery.ts",
    `import { mark } from "./mark.js";

export default {
  name: "Badge",
  sample: { label: "Lamp" },
  render(data: { label: string }): string {
    return mark(data.label);
  },
};
`,
  );

  const second = await page("branch-deploy", root);
  const secondBody = await second.text();
  assert.equal(second.status, 200);
  assert.equal(secondBody.includes("<p>Desk</p>"), true);
  assert.equal(secondBody.includes("<em>Lamp</em>"), true);
  assert.equal(secondBody.includes(BANNER), true);
});

test("an empty gallery still shows the dev banner and noindex", async () => {
  const response = await page("dev", await uiRoot());
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(body.includes("No renders yet."), true);
  assert.equal(body.includes(BANNER), true);
  assert.equal(body.includes(ROBOTS), true);
  assert.equal(body.includes(TOKENS), true);
});

test("a gallery name is text, not markup", async () => {
  const root = await uiRoot();
  await writeUi(
    root,
    "widgets/badge.gallery.ts",
    `export default {
  name: "A<B",
  sample: { label: "Lamp" },
  render(): string {
    return "ok";
  },
};
`,
  );
  const body = await (await page("dev", root)).text();
  assert.equal(body.includes("A&lt;B"), true);
  assert.equal(body.includes("A<B"), false);
  assert.equal(body.includes("ok"), true);
});

async function closed(deployContext: string | undefined): Promise<void> {
  const root = await uiRoot();
  await writeUi(
    root,
    "widgets/boom.gallery.ts",
    `throw new Error("gallery file was loaded");
export default {
  name: "Boom",
  sample: {},
  render(): string {
    return "boom";
  },
};
`,
  );
  const response = await page(deployContext, root);
  const body = await response.text();
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(body.includes(BANNER), false);
  assert.equal(body.includes("boom"), false);
  assert.equal(body.includes("gallery file was loaded"), false);
}

test("production returns 404 before loading a gallery file", async () => {
  await closed("production");
  await closed(" production ");
});

test("a missing deploy context returns 404 before loading a gallery file", async () => {
  await closed(undefined);
  await closed("");
  await closed("   ");
});

test("the netlify route reads APP_DEPLOY_CONTEXT", async () => {
  const previousContext = process.env.APP_DEPLOY_CONTEXT;
  const previousHost = process.env.APP_PROD_DB_HOST;
  const previousMode = process.env.MODE;
  try {
    process.env.MODE = "mock";
    process.env.APP_PROD_DB_HOST = "app-prod-guard.example.test";
    process.env.APP_DEPLOY_CONTEXT = "production";
    const closedResponse = await gallery();
    assert.equal(closedResponse.status, 404);
    assert.equal((await closedResponse.text()).includes(BANNER), false);

    process.env.APP_DEPLOY_CONTEXT = "dev";
    const openResponse = await gallery();
    const body = await openResponse.text();
    assert.equal(openResponse.status, 200);
    assert.equal(body.includes(BANNER), true);
    assert.equal(body.includes(ROBOTS), true);
    assert.equal(body.includes("<title>Portal Starter render gallery</title>"), true);
  } finally {
    if (previousContext === undefined) delete process.env.APP_DEPLOY_CONTEXT;
    else process.env.APP_DEPLOY_CONTEXT = previousContext;
    if (previousHost === undefined) delete process.env.APP_PROD_DB_HOST;
    else process.env.APP_PROD_DB_HOST = previousHost;
    if (previousMode === undefined) delete process.env.MODE;
    else process.env.MODE = previousMode;
  }
});

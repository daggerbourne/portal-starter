import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { SETTINGS_KEYS, USER_STATES, type SettingsKey } from "../../../contracts/domain.js";
import devBannerGallery from "../../../ui/admin/dev-banner.gallery.js";
import settingsGallery from "../../../ui/admin/settings-page.gallery.js";
import userPageGallery from "../../../ui/admin/user-page.gallery.js";
import usersGallery from "../../../ui/admin/users-page.gallery.js";
import { renderDevBanner, type DevBannerView } from "../../../ui/admin/dev-banner.js";
import { renderSettings } from "../../../ui/admin/settings-page.js";
import { renderUserPage, type UserPageView } from "../../../ui/admin/user-page.js";
import { renderUsers, type UserRow } from "../../../ui/admin/users-page.js";
import portalGallery from "../../../ui/portal/home.gallery.js";
import { renderPortalHome } from "../../../ui/portal/home.js";

const BANNER = "DEV/preview environment. Test data only.";

function user(id: number, displayName: string, state: UserRow["state"], updatedAt = "2026-07-15T18:30:00.000Z"): UserRow {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    displayName,
    email: `${displayName.split(" ")[0]?.toLowerCase() ?? "user"}@example.test`,
    state,
    updatedAt,
  };
}

test("users list links each user and counts every state", () => {
  const markup = renderUsers({
    role: "staff",
    users: [user(1, "Ada Hollow", "active"), user(2, "Nico Vale", "invited"), user(3, "June Peck", "active")],
  });
  assert.equal(markup.includes('href="/portal-starter/admin/users/00000000-0000-4000-8000-000000000001"'), true);
  assert.equal(markup.includes("ada@example.test"), true);
  assert.equal(markup.includes("active 2"), true);
  assert.equal(markup.includes("invited 1"), true);
  assert.equal(markup.includes("suspended 0"), true);
  for (const state of USER_STATES) assert.equal(markup.includes(state), true, state);
  assert.equal(markup.includes("Jul 15, 1:30 PM CT"), true);
  assert.equal(markup.includes("Role: Staff"), true);
});

test("staff do not see the settings link and the owner does", () => {
  const staff = renderUsers({ role: "staff", users: [] });
  const owner = renderUsers({ role: "owner", users: [] });
  assert.equal(staff.includes('href="/portal-starter/admin/settings"'), false);
  assert.equal(owner.includes('href="/portal-starter/admin/settings"'), true);
  assert.equal(staff.includes('aria-current="page">Users<'), true);
});

test("an empty users list says how a user appears", () => {
  const markup = renderUsers({ role: "staff", users: [] });
  assert.equal(markup.includes("No users yet."), true);
  assert.equal(markup.includes("<table>"), false);
});

test("time labels cross the March daylight-saving change", () => {
  const before = renderUsers({ role: "staff", users: [user(1, "Ada Hollow", "active", "2026-03-08T07:30:00.000Z")] });
  const after = renderUsers({ role: "staff", users: [user(1, "Ada Hollow", "active", "2026-03-08T08:30:00.000Z")] });
  assert.equal(before.includes("1:30 AM CT"), true);
  assert.equal(after.includes("3:30 AM CT"), true);
});

test("renders escape user text and are pure", () => {
  const view = { role: "staff" as const, users: [user(1, `A<B "&`, "active")] };
  const markup = renderUsers(view);
  assert.equal(markup.includes("A&lt;B &quot;&amp;"), true);
  assert.equal(markup.includes("A<B"), false);
  assert.equal(renderUsers(view), markup);
  const portal = renderPortalHome({ displayName: "<script>", email: "x@example.test" });
  assert.equal(portal.includes("<script>"), false);
  assert.equal(portal.includes("&lt;script&gt;"), true);
});

test("a user page shows the reason only when suspended", () => {
  const base: UserPageView = {
    role: "owner",
    displayName: "June Peck",
    email: "june@example.test",
    provider: "stub",
    state: "active",
    createdAt: "2026-06-01T14:00:00.000Z",
    suspendedReason: null,
  };
  const active = renderUserPage(base);
  const suspended = renderUserPage({ ...base, state: "suspended", suspendedReason: "Synthetic reason" });
  assert.equal(active.includes("Suspended because"), false);
  assert.equal(suspended.includes("Suspended because"), true);
  assert.equal(suspended.includes("Synthetic reason"), true);
  assert.equal(active.includes("<code>stub</code>"), true);
});

test("settings page lists every settings key", () => {
  const values: Record<SettingsKey, string> = { display_name: "Synthetic", support_email: "help@example.test" };
  const markup = renderSettings({ values });
  for (const key of SETTINGS_KEYS) assert.equal(markup.includes(key), true, key);
  assert.equal(markup.includes("help@example.test"), true);
  assert.equal(markup.includes("Role: Owner"), true);
  assert.equal(renderSettings({ values }), markup);
});

test("dev banner shows the given label and the fixed sentence, with no dismiss control", () => {
  const view: DevBannerView = { databaseLabel: `preview/pr-33 <dev>` };
  const markup = renderDevBanner(view);
  assert.equal(markup.includes(BANNER), true);
  assert.equal(markup.includes("preview/pr-33 &lt;dev&gt;"), true);
  assert.equal(markup.includes("<button"), false);
  assert.equal(/dismiss/i.test(markup), false);
  assert.equal(renderDevBanner(view), markup);
});

test("the portal home has no admin navigation", () => {
  const markup = renderPortalHome({ displayName: "Ada Hollow", email: "ada@example.test" });
  assert.equal(markup.includes("Welcome, Ada Hollow"), true);
  assert.equal(markup.includes("/portal-starter/admin"), false);
  assert.equal(markup.includes('href="/portal-starter/portal/auth/logout"'), true);
});

test("renders do not import server, db, or adapters", () => {
  const files = globSync("ui/**/*.ts").sort();
  assert.equal(files.length > 0, true);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/from\s+["'][^"']*(server|db|adapters)\//.test(source), false, file);
  }
});

function rendersItsSample<Data>(entry: { readonly name: string; readonly sample: Data; readonly render: (data: Data) => string }): string {
  assert.equal(entry.name.length > 0, true);
  const markup = entry.render(entry.sample);
  assert.equal(markup.length > 0, true);
  assert.equal(entry.render(entry.sample), markup);
  return markup;
}

test("each gallery entry renders its sample", () => {
  assert.equal(rendersItsSample(usersGallery).includes("Ada Hollow"), true);
  assert.equal(rendersItsSample(userPageGallery).includes("Synthetic sample reason"), true);
  assert.equal(rendersItsSample(settingsGallery).includes("support_email"), true);
  assert.equal(rendersItsSample(devBannerGallery).includes(BANNER), true);
  assert.equal(rendersItsSample(portalGallery).includes("Welcome, Ada Hollow"), true);
});

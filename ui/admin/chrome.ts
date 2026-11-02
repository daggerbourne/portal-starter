import type { UserState } from "../../contracts/domain.js";
import { escapeHtml, stateLabel } from "./format.js";
import { lockup } from "./lockup.js";

export type AdminPage = "users" | "settings";
export type AdminRole = "staff" | "owner";

const ROLE_LABEL: Record<AdminRole, string> = {
  staff: "Staff",
  owner: "Owner",
};

const NAV: readonly { readonly id: AdminPage; readonly label: string; readonly href: string; readonly owner: boolean }[] = [
  { id: "users", label: "Users", href: "/portal-starter/admin", owner: false },
  { id: "settings", label: "Settings", href: "/portal-starter/admin/settings", owner: true },
];

const STYLES = `<style>
.admin { color: var(--text-primary); font-family: var(--font-sans); font-size: var(--fs-body); line-height: var(--lh-body); background: var(--bg-deep); max-width: 100%; overflow-wrap: anywhere; }
.admin * { box-sizing: border-box; }
.admin .site-nav, .admin .anav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.admin .site-nav { min-height: var(--nav-height); padding: var(--space-3) var(--space-4); }
.admin .anav { background: var(--bg-surface); padding: var(--space-2) var(--space-4); }
.admin .lockup { font-size: var(--fs-lg); font-weight: var(--fw-bold); letter-spacing: var(--tracking-heading); }
.admin .site-nav a, .admin .anav a, .admin .btn { min-height: var(--tap); min-width: var(--tap); display: inline-flex; align-items: center; justify-content: center; padding: 0 var(--space-4); color: var(--text-primary); font-size: var(--fs-sm); font-weight: var(--fw-medium); text-decoration: none; }
.admin .anav a[aria-current="page"] { background: var(--bg-card); box-shadow: inset 0 calc(var(--space-1) * -1) 0 var(--primary); }
.admin .role { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: var(--fw-medium); }
.admin main { width: var(--container); margin: 0 auto; padding: var(--space-8) 0 var(--space-20); }
.admin h1 { font-size: var(--fs-h2); line-height: var(--lh-heading); letter-spacing: var(--tracking-heading); font-weight: var(--fw-bold); margin: 0 0 var(--space-4); }
.admin h2, .admin h3 { font-size: var(--fs-h3); line-height: var(--lh-heading); font-weight: var(--fw-semibold); margin: var(--space-4) 0 var(--space-2); }
.admin h3 { font-size: var(--fs-sm); }
.admin .card { background: var(--bg-card); border-radius: var(--radius); padding: var(--space-6); margin: 0 0 var(--space-4); }
.admin .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
.admin .chip { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: var(--fw-medium); }
.admin table { width: 100%; border-collapse: collapse; }
.admin th, .admin td { text-align: left; padding: var(--space-3) var(--space-4); font-size: var(--fs-sm); border-bottom: 1px solid var(--border); vertical-align: middle; }
.admin th { font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.admin tbody tr:nth-child(even) { background: var(--bg-surface); }
.admin .num { text-align: right; font-variant-numeric: tabular-nums; }
.admin .empty { color: var(--text-secondary); margin: var(--space-2) 0 var(--space-4); }
.admin .field { display: block; min-height: var(--control-h); padding: var(--space-3) var(--space-4); background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: var(--radius); font-weight: var(--fw-regular); }
.admin .btn--primary { background: var(--accent-gradient); color: var(--on-primary); border: 0; border-radius: var(--radius); font-weight: var(--fw-semibold); min-height: var(--control-h); cursor: pointer; transition: transform var(--dur-fast) var(--ease-out); }
.admin .btn--primary:hover { background: var(--primary-hover); color: var(--on-primary); transform: translateY(-1px); }
.admin .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-top: var(--space-4); }
.admin .meta, .admin dt { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: var(--fw-medium); }
.admin dd { margin: 0 0 var(--space-3); }
.admin code { font-family: var(--font-mono); font-size: var(--fs-sm); }
.admin a:focus-visible, .admin button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 767px) {
  .admin table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .admin table, .admin tbody, .admin tr, .admin td { display: block; width: 100%; }
  .admin tr { margin-bottom: var(--space-3); background: var(--bg-card); border-radius: var(--radius); }
  .admin td { display: flex; justify-content: space-between; gap: var(--space-3); text-align: left; }
  .admin td[data-l]::before { content: attr(data-l); font-weight: var(--fw-semibold); }
  .admin .actions .btn--primary { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .admin .btn--primary, .admin .btn--primary:hover { transform: none; transition: none; }
}
</style>`;

export function chip(state: UserState): string {
  return `<span class="chip"><span aria-hidden="true">●</span> ${escapeHtml(stateLabel(state))}</span>`;
}

export function emptyState(sentence: string): string {
  return `<p class="empty"><span aria-hidden="true">○</span> ${escapeHtml(sentence)}</p>`;
}

export function shell(page: AdminPage, role: AdminRole, body: string): string {
  const nav = NAV.filter((item) => !item.owner || role === "owner")
    .map((item) => {
      const current = item.id === page ? ` aria-current="page"` : "";
      return `<a href="${item.href}"${current}>${item.label}</a>`;
    })
    .join("");
  return `<article class="admin">${STYLES}<header class="site-nav"><span class="lockup">${lockup}</span></header><nav class="anav" aria-label="Admin">${nav}<a href="/portal-starter/auth/logout">Sign out</a><span class="role">Role: ${ROLE_LABEL[role]}</span></nav><main>${body}</main></article>`;
}

import { escapeHtml } from "../admin/format.js";
import { lockup } from "../admin/lockup.js";

export type PortalHomeView = {
  readonly displayName: string;
  readonly email: string;
};

const STYLES = `<style>
.portal { color: var(--text-primary); font-family: var(--font-sans); font-size: var(--fs-body); line-height: var(--lh-body); background: var(--bg-deep); max-width: 100%; overflow-wrap: anywhere; }
.portal * { box-sizing: border-box; }
.portal .site-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--nav-height); padding: var(--space-3) var(--space-4); }
.portal .lockup { font-size: var(--fs-lg); font-weight: var(--fw-bold); letter-spacing: var(--tracking-heading); }
.portal .site-nav a { min-height: var(--tap); display: inline-flex; align-items: center; padding: 0 var(--space-4); color: var(--link); font-size: var(--fs-sm); font-weight: var(--fw-medium); }
.portal main { width: var(--container); margin: 0 auto; padding: var(--space-8) 0 var(--space-20); }
.portal h1 { font-size: var(--fs-h2); line-height: var(--lh-heading); letter-spacing: var(--tracking-heading); font-weight: var(--fw-bold); margin: 0 0 var(--space-4); }
.portal .card { background: var(--bg-card); border-radius: var(--radius); padding: var(--space-6); margin: 0 0 var(--space-4); }
.portal .meta { color: var(--text-secondary); font-size: var(--fs-sm); }
.portal a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
</style>`;

export function renderPortalHome(view: PortalHomeView): string {
  return `<article class="portal">${STYLES}<header class="site-nav"><span class="lockup">${lockup}</span><a href="/portal-starter/portal/auth/logout">Sign out</a></header><main><h1>Welcome, ${escapeHtml(view.displayName)}</h1><section class="card"><p>You're signed in to your portal.</p><p class="meta">Signed in as ${escapeHtml(view.email)}</p></section></main></article>`;
}

import { escapeHtml } from "./format.js";

export type DevBannerView = {
  readonly databaseLabel: string;
};

const STYLES = `<style>
.app-dev-banner { margin: 0; background: var(--dev-banner-bg); color: var(--dev-banner-text); font-family: var(--font-sans); font-size: var(--fs-sm); font-weight: var(--fw-semibold); line-height: var(--lh-body); padding: var(--space-3) var(--space-4); overflow-wrap: anywhere; max-width: 100%; }
</style>`;

export function renderDevBanner(view: DevBannerView): string {
  return `${STYLES}<p class="app-dev-banner" role="status">DEV/preview environment. Test data only. ${escapeHtml(view.databaseLabel)}</p>`;
}

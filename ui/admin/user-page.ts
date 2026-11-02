import type { UserState } from "../../contracts/domain.js";
import { chip, shell, type AdminRole } from "./chrome.js";
import { escapeHtml, formatInstant } from "./format.js";

export type UserPageView = {
  readonly role: AdminRole;
  readonly displayName: string;
  readonly email: string;
  readonly provider: string;
  readonly state: UserState;
  readonly createdAt: string;
  readonly suspendedReason: string | null;
};

export function renderUserPage(view: UserPageView): string {
  const reason =
    view.suspendedReason === null ? "" : `<dt>Suspended because</dt><dd>${escapeHtml(view.suspendedReason)}</dd>`;
  const body = `<h1>${escapeHtml(view.displayName)}</h1><p>${chip(view.state)}</p><section class="card"><dl><dt>Email</dt><dd>${escapeHtml(view.email)}</dd><dt>Sign-in provider</dt><dd><code>${escapeHtml(view.provider)}</code></dd><dt>Joined</dt><dd>${escapeHtml(formatInstant(view.createdAt))}</dd>${reason}</dl></section><p class="actions"><a href="/portal-starter/admin">Back to users</a></p>`;
  return shell("users", view.role, body);
}

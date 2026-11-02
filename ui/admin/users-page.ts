import { USER_STATES, type UserState } from "../../contracts/domain.js";
import { chip, emptyState, shell, type AdminRole } from "./chrome.js";
import { escapeHtml, formatInstant } from "./format.js";

export type UserRow = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly state: UserState;
  readonly updatedAt: string;
};

export type UsersView = {
  readonly role: AdminRole;
  readonly users: readonly UserRow[];
};

function row(user: UserRow): string {
  const href = `/portal-starter/admin/users/${encodeURIComponent(user.id)}`;
  return `<tr><td data-l="Name"><a href="${href}">${escapeHtml(user.displayName)}</a></td><td data-l="Email">${escapeHtml(user.email)}</td><td data-l="State">${chip(user.state)}</td><td data-l="Updated">${escapeHtml(formatInstant(user.updatedAt))}</td></tr>`;
}

function counts(users: readonly UserRow[]): string {
  return USER_STATES.map((state) => {
    const total = users.filter((user) => user.state === state).length;
    return `<span class="chip">${escapeHtml(state)} ${String(total)}</span>`;
  }).join(" ");
}

export function renderUsers(view: UsersView): string {
  const table =
    view.users.length === 0
      ? emptyState("No users yet. A user appears here after their first sign-in.")
      : `<table><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">State</th><th scope="col">Updated</th></tr></thead><tbody>${view.users.map(row).join("")}</tbody></table>`;
  const body = `<h1>Users</h1><p class="meta">${counts(view.users)}</p>${table}`;
  return shell("users", view.role, body);
}

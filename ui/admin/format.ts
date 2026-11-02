import type { UserState } from "../../contracts/domain.js";

export const TIME_ZONE = "America/Chicago";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function stateLabel(state: UserState): string {
  return `${state.slice(0, 1).toUpperCase()}${state.slice(1).replaceAll("_", " ")}`;
}

export function formatInstant(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortGeneric",
  }).format(new Date(instant));
}

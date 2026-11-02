declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export const ROLES = ["user", "staff", "owner", "system"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATES = ["invited", "active", "suspended"] as const;
export type UserState = (typeof USER_STATES)[number];

const USER_EDGES = [
  ["invited", "active"],
  ["active", "suspended"],
  ["suspended", "active"],
] as const satisfies readonly (readonly [UserState, UserState])[];

const DRAWN_USERS = new Set(USER_EDGES.map(([from, to]) => `${from}>${to}`));

export type UserEvent =
  | { readonly type: "activate" }
  | { readonly type: "suspend"; readonly reason: string };

export type UserTransition =
  | { readonly ok: true; readonly state: UserState; readonly noop: boolean }
  | { readonly ok: false; readonly refusal: { readonly code: "not_drawn" | "reason_empty" } };

export const SETTINGS_KEYS = ["display_name", "support_email"] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

export const DATABASE_ENUMS = {
  role: ROLES,
  user_state: USER_STATES,
} as const;

function userDestination(event: UserEvent): UserState {
  switch (event.type) {
    case "activate":
      return "active";
    case "suspend":
      return "suspended";
    default: {
      const leftover: never = event;
      throw new Error(String(leftover));
    }
  }
}

export function transitionUser(state: UserState, event: UserEvent): UserTransition {
  if (event.type === "suspend" && event.reason.trim() === "") return { ok: false, refusal: { code: "reason_empty" } };
  const to = userDestination(event);
  if (to === state) return { ok: true, state, noop: true };
  if (DRAWN_USERS.has(`${state}>${to}`)) return { ok: true, state: to, noop: false };
  return { ok: false, refusal: { code: "not_drawn" } };
}

export function portalAllowed(state: UserState): boolean {
  return state === "active";
}

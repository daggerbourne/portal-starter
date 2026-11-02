# Domain model

The single source for names, roles, and states. Contracts in `contracts/domain.ts` encode this file. When code and this file disagree, fix one of them in the same PR. Don't let them drift.

Each stateful object has one state machine, encoded as data with one `transition` function, and moves only through the transitions below (**model-the-domain**). Add the app's own objects and machines here, in the same shape, as milestones arrive.

## People and roles

| Role | Who | Can |
|---|---|---|
| `user` | Someone who signs in to the portal | See and change only their own data. |
| `staff` | Staff signed in with Microsoft Entra | Use admin: see users and run the app's staff work. |
| `owner` | The person who runs the app (the Owner) | Everything staff can, plus settings. |
| `system` | Scheduled jobs and adapters | Only what a spec names. |

Roles come from the server-side session and the `staff` and `app_user` tables. Never from a query string, header, form field, or environment variable (standing order 11).

## Sessions

| Session | Cookie | Key | Opens |
|---|---|---|---|
| Staff | `app_session` | `APP_SESSION_KEY` | `/portal-starter/admin/**` |
| User | `app_user_session` | `APP_USER_SESSION_KEY` | `/portal-starter/portal/**` |

Both are signed, HttpOnly, Secure, `SameSite=Lax` cookies on `/portal-starter`, valid 12 hours. Each carries a `purpose` that the other side refuses, and the portal refuses to run when the two keys are equal. A user session re-reads the user's state on every request, so suspension takes effect at once.

Staff sign-in: Microsoft Entra, app role `PortalStarter.Staff`, then the `staff` table decides `staff` or `owner`. Sign-in works only on the hosts in `server/auth/config.ts` (production, `main`, `auth-test`, and localhost); previews say "sign-in isn't available on previews".

User sign-in: a `UserSignInProvider` (`server/portal/user-sign-in.ts`) with `start` and `finish`. The template ships `stubUserProvider`, which answers `501`. Gate G2 picks the real one.

## Objects

| Object | Meaning |
|---|---|
| Staff | A staff member: Entra object id, email, display name, role `staff` or `owner`. |
| User | A portal user (`app_user`): provider, subject, email, display name, state. One row per provider and subject. |
| Settings | Versioned key and value. Keys are listed in `contracts/domain.ts`; the database checks them. |
| Audit row | One per adapter call and per sensitive action. No personal data. |

## User states

```
invited ──activate──▶ active ──suspend(reason)──▶ suspended
                        ▲                              │
                        └──────────activate────────────┘
```

- Only `active` reaches the portal (`portalAllowed`).
- First sign-in: no row yet → created `active`. An `invited` row → `active`. A `suspended` row → refused.
- Suspending needs a non-empty reason, stored in `suspended_reason`, which the database requires for `suspended` and forbids otherwise.
- A same-state move is a no-op. Anything not drawn is refused with `not_drawn`.

## Data rules

- Every table has `id`, `created_at`, `updated_at`, `created_by` (an actor ref), and `archived_at`. No `ON DELETE CASCADE`, no `DELETE FROM` in app code.
- Times are stored in UTC and shown in America/Chicago with a "CT" label.
- Money, if the app handles any, is integer cents.

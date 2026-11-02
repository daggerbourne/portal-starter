# Users list

The users list is the staff home at `/portal-starter/admin` on auth-test. It lists app users with their state. A fresh database shows the empty state.

## Sub-features

- `staff-users` records the list heading `Users` with rows or the empty state.

## How to get to it (user POV)

- Sign in as the account in `APP_TEST_STAFF_EMAIL` on auth-test.
- Open `/portal-starter/admin`.

## Driving it with verify-app

Preconditions:

- `node .cursor/skills/verify-app/run.mjs patterns` exits `0`.
- `APP_TEST_STAFF_EMAIL` and `APP_TEST_STAFF_PASSWORD` are set.

- **List.** Run `node .cursor/skills/verify-app/run.mjs drive --feature users`. The command signs in as staff and prints a `staff users` line with the row and empty counts.
- **Proof.** `staff-users.png` in the run's evidence directory.

## Gotchas

- The route is `/portal-starter/admin`, on the `/portal-starter/` site.
- Settings is owner-only. The staff test account gets `403` there, which is correct.

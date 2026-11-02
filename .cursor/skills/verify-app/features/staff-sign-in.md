# Staff sign-in

Staff sign in with Microsoft on auth-test. A staff user then sees the users list. A user with no staff role gets `403` and the text `forbidden`.

Accounts:

- The account in `APP_TEST_STAFF_EMAIL` has the Entra app role `PortalStarter.Staff`.
- The account in `APP_TEST_NOSTAFF_EMAIL` has no staff role.

## Sub-features

- `sign-in` opens `/portal-starter/auth/login` and completes Microsoft sign-in.
- `staff-users` records the users list at `/portal-starter/admin`.
- `nostaff-forbidden` records the `403` text `forbidden`.

## How to get to it (user POV)

- Open `https://auth-test--portal-starter.netlify.app/portal-starter/auth/login`.
- Microsoft asks for the email, then the password. It sometimes asks for an authenticator code. It sometimes does not.
- Staff returns to Portal Starter and can open `/portal-starter/admin`.
- A user with no staff role stays on a page whose text is `forbidden`.

## Driving it with verify-app

Preconditions:

- `node .cursor/skills/verify-app/run.mjs patterns` exits `0`.
- `google-chrome` is on `PATH`.
- `APP_TEST_STAFF_EMAIL`, `APP_TEST_NOSTAFF_EMAIL`, `APP_TEST_STAFF_PASSWORD`, and `APP_TEST_NOSTAFF_PASSWORD` are set. The drive reads them and never prints them.
- `APP_TEST_STAFF_TOTP` and `APP_TEST_NOSTAFF_TOTP` are set when Microsoft shows a code prompt. Each value is a base32 setup key. The drive types a 6-digit code only when that prompt is on screen.

- **Both users.** Run `node .cursor/skills/verify-app/run.mjs drive --feature staff-sign-in`. The command uses auth-test. It prints a `staff users` line and a `nostaff forbidden` line.
- **Missing password.** The same command with those password variables unset prints `test password secret missing` and exits `2`.
- **Preview.** `drive --feature staff-sign-in --target preview --pr <number>` prints `sign-in isn't available on previews` and exits `0` when that sentence is the page. That is not a failure.
- **Proof.** `staff-users.png` shows the users list, or its empty state on a fresh database. `nostaff-forbidden.png` shows `forbidden`.

## Gotchas

- Do not print, log, or save a test email, a password, a code, a setup key, a session cookie, or an object id.
- Do not create an account or change an Entra role.
- Main and other previews are not the live sign-in host. auth-test is.
- A code prompt that appears with `APP_TEST_STAFF_TOTP` or `APP_TEST_NOSTAFF_TOTP` unset stops the drive. The command prints `test totp secret missing` and exits `2`.

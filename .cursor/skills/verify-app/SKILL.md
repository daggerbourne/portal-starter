---
name: verify-app
description: Drive the deployed Portal Starter site at /portal-starter/ on its Netlify previews. Use when a QA verifier opens a deploy preview, checks that the preview is public, signs in on auth-test, or captures a screenshot of the hello page or the users list.
---

# Verify Portal Starter

Drive the deployed Portal Starter site. The page under test is the Netlify deploy, not a local server. Run the commands from the repository root.

Allowed targets:

- `https://main--portal-starter.netlify.app/portal-starter/`
- `https://auth-test--portal-starter.netlify.app/portal-starter/`
- `https://deploy-preview-<pr>--portal-starter.netlify.app/portal-starter/`

Do not open any other host yourself. A staff sign-in drive may follow the redirect from `/portal-starter/auth/login` to Microsoft sign-in. The harness refuses any other host. Read the feature map in `features/README.md` before choosing a feature.

## Launch

Launch records a run and does not start a server.

```bash
node .cursor/skills/verify-app/run.mjs launch --target main
```

For a pull request preview that Netlify built, pass the pull request number.

```bash
node .cursor/skills/verify-app/run.mjs launch --target preview --pr 5
```

Ready means the next doctor command prints `live` with status `200` and kind `app`. The run directory is `/tmp/verify-app/<run-id>/`. A second launch uses a new run id.

## Doctor

Run doctor before the first drive, and again after a failed drive.

```bash
node .cursor/skills/verify-app/run.mjs doctor --target main
```

Doctor first confirms both allowed URL shapes with no network. The main shape is `https://main--portal-starter.netlify.app/portal-starter/`. The preview shape is `https://deploy-preview-5--portal-starter.netlify.app/portal-starter/`. It then classifies these login URLs as `netlify-login`:

- `https://app.netlify.com/login`
- `https://app.netlify.com/sso`
- `https://app.netlify.com/signup`
- `https://app.netlify.com/access`

A status `401` on an allowed Portal Starter URL is also `netlify-login`. That is the password wall.

If the live page is a Netlify login page, doctor prints this and exits `1`:

```text
Netlify login page. Stop. Matched <pattern> at <url>. Do not type a password.
```

Stop. Do not type a password. Do not continue to drive.

The rows live in `patterns.md`. To recheck that table alone, with no network:

```bash
node .cursor/skills/verify-app/run.mjs patterns
```

`patterns` must exit `0`. Do not reimplement those checks by hand.

## Drive

Drive one built feature end to end with `run`. `run` launches, runs doctor, drives the hello page, writes evidence, and cleans up.

```bash
node .cursor/skills/verify-app/run.mjs run --target main
```

```bash
node .cursor/skills/verify-app/run.mjs run --target preview --pr <number>
```

The hello page must show title `Portal Starter`, heading `Hello`, and stylesheet `tokens.css`. `tokens.css` must return status `200`, content type `text/css`, and the text `--bg-deep`.

Staff sign-in and the users list are real drives. They default to auth-test, the host where sign-in is on. Pass `--target preview --pr <number>` for a pull request preview. On that preview the page `sign-in isn't available on previews` is the result, and it is not a failure.

```bash
node .cursor/skills/verify-app/run.mjs drive --feature staff-sign-in
```

```bash
node .cursor/skills/verify-app/run.mjs drive --feature users
```

The drive reads `APP_TEST_STAFF_EMAIL`, `APP_TEST_NOSTAFF_EMAIL`, `APP_TEST_STAFF_PASSWORD`, and `APP_TEST_NOSTAFF_PASSWORD` from the environment. The users drive reads the staff email and password only. If a password is missing, the command prints `test password secret missing` and exits `2`. It prints no secret value.

When Microsoft shows a code prompt, the drive types a 6-digit code from `APP_TEST_STAFF_TOTP` or `APP_TEST_NOSTAFF_TOTP`. It types a code only when that prompt is on screen. If the prompt is up and the matching variable is missing, the command prints `test totp secret missing` and exits `2`.

Do not print, log, or save a password, a code, a setup key, a session cookie, or an object id.

## Evidence

`run` writes these files under `/tmp/verify-app/<run-id>/evidence/`:

- `doctor.txt` holds the doctor lines, including the login classification.
- `drive.txt` holds the hello-page result.
- `hello.png` is the screenshot.

A staff sign-in drive writes `drive.txt`, `staff-users.png`, and `nostaff-forbidden.png` in that same evidence directory. A users drive writes `drive.txt` and `staff-users.png`. The users shot is the list at `/portal-starter/admin`. The forbidden shot is the plain text `forbidden`.

Paste the command output into the verdict or the PR. Attach the screenshots. Do not attach the Chrome profile. The profile is scratch, and it is removed.

A passing `run` prints `evidence kept` and a size above `1000` after cleanup. If that file is gone, the run failed.

## Cleanup

`run` already cleans up. To clean a run that stopped early:

```bash
node .cursor/skills/verify-app/run.mjs cleanup --run-id <run-id>
```

Cleanup deletes that run's Chrome profile and stops the Chrome process only when `/proc/<pid>/cmdline` contains that profile path. It does not delete `evidence/`. Running it twice prints `already clean` or removes nothing further, and exits `0`.

The Netlify deploy is shared and read-only. Concurrent runs are safe because each run id has its own directory. Do not submit a form on the Portal Starter deploy. The staff sign-in drive submits the Microsoft sign-in form only.

## Helpers

The harness is `run.mjs`. Invoke it with `node`, as the sections above do. It is executable.

When a later unit changes a page this map describes, run `/maintain-verification-skill` on this skill.

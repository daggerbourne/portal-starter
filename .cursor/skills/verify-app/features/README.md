# Portal Starter verification map

Read this index before driving the deploy, then follow one feature file.

## Baseline preconditions

- The site is already deployed. Do not start a local server.
- Main's branch deploy is `https://main--portal-starter.netlify.app/portal-starter/`.
- A pull request preview is `https://deploy-preview-<pr>--portal-starter.netlify.app/portal-starter/`.
- Run `node .cursor/skills/verify-app/run.mjs patterns` and require exit `0`.
- Run doctor on the target URL and require kind `app` before driving a built feature.
- A Markdown-only pull request has no new Netlify build. Use main, or a preview Netlify did build.
- Staff sign-in and the users list run on `https://auth-test--portal-starter.netlify.app/portal-starter/`. A deploy preview that shows `sign-in isn't available on previews` is not a failure.

## Driving conventions

- Run every command from the repository root.
- Treat each command as literal.
- Drive the browser only through `run.mjs`.
- Open main, auth-test, or a deploy preview. The staff sign-in drive may follow the redirect to Microsoft sign-in.
- Keep proof files. Cleanup removes the Chrome profile only.

## Proof and skip reporting

- Capture the doctor lines and the screenshot, not the screenshot alone.
- Record the feature id and the URL.
- Exit `2` means a test email or password is missing, or a code prompt appeared and the totp secret is missing. Do not report that run as verified.
- Do not report a skipped entry point as verified through the hello page.

## Features

- [Hello page](./hello-page.md) is on main now, at `/portal-starter/`, and it loads `tokens.css`.
- [Staff sign-in](./staff-sign-in.md) signs in on auth-test. Staff lands on the users list. A user with no staff role gets `403` and the text `forbidden`.
- [Users list](./users.md) needs a staff session and screenshots the list at `/portal-starter/admin`.
- The user portal at `/portal-starter/portal` has no feature file yet. Its sign-in is a stub that answers `501` until the app picks a provider. Add a feature file in the unit that wires the provider.

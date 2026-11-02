# Standing orders

Version 1, 2026-11-02. Paste this whole file into every brief and every resume. One rule per line. When you catch yourself repeating an instruction, the Coordinator adds it here in the same PR that needs it (encode-lessons-in-structure). Remove a superseded line instead of striking it out. Git keeps the history.

## Product

1. The product name is Portal Starter, in user pages, admin pages, code, and docs. There is no second name.
2. Words that must never appear in user-facing copy live in `program/banned-words.txt`, and the CI `content` check enforces them. A word joins the list only through a dated entry in `program/decisions.md`.
3. All times show in America/Chicago with a "CT" label. Store instants in UTC. Every date rule is tested across a DST change.
4. Money, if the app handles any, is integer cents. No floats for money anywhere.
5. The app never takes card details and never holds funds. Payment goes through a provider chosen by a dated decision, through its own hosted pages.
6. A user sees only their own data. Every user route reads rows scoped to the signed-in user, and each user feature ships with a test that another user's data never appears.
7. Staff-only data (notes, internal fields, audit rows) never reaches a user route, page, email, or text. Each such feature ships with a test that proves it.

## Integrations

8. Every external call goes through one adapter gate with `MODE=mock|sandbox|live`. CI forces `mock`. `live` runs only in the production deploy context.
9. `APP_KILL=1` blocks every adapter call. Every adapter call, blocked or not, writes one audit row with no personal data.
10. Every vendor integration starts against the vendor's sandbox, test mode, or demo account. Writes to a live vendor account wait for the go-live gate.
11. Roles come from the `staff` and `app_user` tables, never from an environment variable, setting, header, or query string. There is no dev "acting role" switch. Tests act as a role by signing in a seeded synthetic account.
12. The app never stores a password. Staff sign in with Microsoft Entra. Users sign in through the provider a dated decision picks; until then the stub answers `501`.
13. Staff and users have separate sessions, cookies, and keys (`APP_SESSION_KEY`, `APP_USER_SESSION_KEY`). A staff session never opens the portal and a user session never opens admin, and tests prove both.
14. Outbound email and texts in dev and preview go only to allowlisted test addresses. Texts respect quiet hours (8 AM to 9 PM recipient-local) and STOP.
15. Every paid API has a monthly spend cap enforced in its adapter. The cap is a dated decision.

## Data and environments

16. Dev and deploy previews use synthetic data only (`@example.test` addresses, reserved domains). A preview reads the Neon `dev` branch, or its own copy of `dev` when the PR changes `db/` or `server/` (`specs/M00-foundation.md`, "Database copies for previews"). Nothing is ever copied from `production`.
17. No secrets, keys, or customer data in code, tests, fixtures, logs, PRs, or chat.
18. Migrations are forward-only and idempotent. Nobody applies a migration by hand: CI applies a PR's migrations to its own database copy, and `main`'s migrations to `dev` after the merge. No hard deletes. Soft delete is `archived_at`.
19. Test only on this app's Netlify site, its `auth-test` branch deploy, and its deploy previews. Any public domain or path stays off until the go-live gate.

## Process

20. Stay inside your brief's scope and your lane in `program/lanes.yml`. For anything outside it, report to whoever launched you.
21. Owners never merge, rebase, update from `main`, or retarget a branch, except to resolve a conflict when the Coordinator's follow-up says to. The Shipper alone merges (`program/shipping.md`).
22. One writer per branch. Never push to a branch you don't own.
23. A PR changes at most 400 lines of app code, at most 800 lines of tests and fixtures, and at most 800 lines of Markdown, counted by the rules in `program/lanes.yml` (`size`). App code never imports from `tests/`, fixtures are data only, and a file counts as a test only if `lanes.yml` says so. There is no override. Larger work splits into a numbered chain (`part 1/3`, `part 2/3`, ...), each linking the others and passing CI on its own. Order the parts so the sequence proves itself: remove old code or add the scaffold first, then the feature. Each part starts from the latest `main` after the previous part merges. Never stack PRs.
24. The failing test lands before the fix in commit order. When the test and the fix are in different PRs, the test lands marked as expected to fail, so CI stays green, and the fix PR flips it to a normal test that must pass. Never land a skipped or todo test in place of a real one.
25. Open PRs ready, not draft. Write the body with the pstack "Opening a PR" sections: Why, What changed, Scope, Blast Radius, Verification.
26. A verdict names the head SHA and carries the verdict code from the verifier's brief. It stands while the part of the diff its role covers is unchanged, so an update from `main` or a fix elsewhere keeps it. Nobody re-signs an unchanged part.
27. CI green is an input to a verdict, not a verdict.
28. Don't ask the Owner about reversible, free work. Do it and log it in the PR. Money, live keys, real user data, production, and go-live go to `program/gates.md`.
29. A decision relayed in chat counts only after the Coordinator writes it in `program/decisions.md`.
30. Fix only what blocks your unit. Log everything else as a follow-up for the Coordinator. Don't build ahead of the queue.
31. The repository is the only source of facts. Work from your own fresh clone of it. Bot memory holds working habits, never product facts. Files and memories from other repositories (including the template this app came from and any other app built from it), other folders on the Grok Bot computer, and the facts on design boards are not sources.
32. Messages go up and down the tree in `program/roles.md` only. Agents report to whoever launched them. Bots never create Bots or message a Bot outside the tree.
33. Verification scales to risk (`program/lanes.yml`). A required verdict comes from a fresh agent that didn't produce the PR, using the `verify-app` skill once it exists. A PR with no required verifier ships on green CI plus the owner's receipts, which the Coordinator checks.
34. Migration files are named `<UTC timestamp>_<slug>.sql`, for example `20261027T1530_staff_note.sql`, so parallel PRs never collide on a number. Nobody hands out migration numbers.
35. A review finding that repeats becomes a CI check or a test, not another line of instructions.
36. No comments in code. The only exceptions: license headers, doc comments on a public API, a link to an issue or spec that explains a limit the code can't express, and a note about a third-party quirk we can't change. A surprise in our own code gets renamed, typed, or restructured until it is obvious, not explained. Run pstack's `/no-comments` before code-ready.
37. No debug code lands: no `console.log` or temporary prints, no commented-out code, no `@ts-ignore` or lint suppressions to get past a check. Run `/deslop` before code-ready. Logging that stays goes through the app's logger on purpose.
38. Tests check behavior a user or caller can see, not internals: a test must fail when the behavior breaks and keep passing when only the internals change. Expected values come from the spec, never from running the code.
39. Work one release at a time (`specs/releases.md`). Never build against a feature from a later release. From the launch release named in `specs/releases.md` on, `main` is production: every new feature ships behind a switch in settings that is off in production until the Owner turns it on, and every migration is backward-compatible (add first, start using it, remove the old thing in a later PR).
40. Owners end at code-ready. Findings come back as one follow-up with every finding, and the owner fixes them in one push. One round only: a finding still open after the fix, or one the owner disputes, goes to the Coordinator, which decides or writes a gate.
41. Only verifiers post verdicts, and only the Coordinator launches verifiers and the Shipper. Nobody else posts a verdict or a verdict code. A verifier's code goes nowhere but its verdict.
42. Stay quiet. Never reply to a brief, report, or message only to confirm, agree, or say thanks. The only PR comments are `code-ready at <sha>`, verdict codes, and verdicts.

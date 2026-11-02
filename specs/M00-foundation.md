# M00: Foundation

## Goal

An app that deploys under `/portal-starter`, lets staff sign in to an admin that lists users, gives users a portal behind a pluggable sign-in, and has CI that enforces the process in [`program/`](../program/) before any feature lands.

**Status:** built. The template ships every unit below. A new app doesn't rebuild them; its R0 proves them on its own services ([R0 in a new app](#r0-in-a-new-app)).

## Why it comes first

The checks exist before the first feature PR, so every PR runs under the final rules from day one (**encode-lessons-in-structure**).

## Stack

- Node 22, TypeScript strict, ESLint, `node:test` through `tsx`.
- Netlify: site build publishes under `/portal-starter`; Netlify Functions serve dynamic routes. Deploy previews for every PR.
- Until the launch release, `main` deploys as a Netlify **branch deploy**, not a production deploy. Netlify charges 15 credits for every production deploy and nothing for previews and branch deploys, and running out of credits pauses every site on the team. Netlify's production branch is `production`, which stays where it is until the launch release switches production to `main` (gate G10).
- The app's only source of visual values is `design/tokens.css`, loaded as is. ui code never copies a token value.
- Neon Postgres: `production` and `dev` branches, plus a short-lived copy of `dev` for each PR that changes `db/` or `server/` ([Database copies for previews](#database-copies-for-previews)). Every other preview and branch deploy uses `dev`.
- Tests never call the network. A test that reaches `fetch` fails.

## Rules

- Every table has `id`, `created_at`, `updated_at`, `created_by` (an actor ref), and `archived_at`. No `ON DELETE CASCADE`, no `DELETE FROM` in app code.
- Migrations are named by UTC timestamp (standing order 34), forward-only, and idempotent: applying one twice changes nothing. The migration runner records applied versions.
- Database enums are generated from `contracts/`. A check fails when the database and the contracts disagree.
- The state machines from [`domain.md`](domain.md) live in `contracts/` as data, with one `transition` function each. The template ships the user state machine.
- The adapter gate `runAdapter` takes `MODE`, checks `APP_KILL`, refuses `live` outside production, and writes one audit row per call. Netlify Functions don't see `CONTEXT` at runtime, so the gate reads `APP_DEPLOY_CONTEXT` and fails closed when it is missing.
- CI runs on GitHub Actions and spends the Owner's Actions minutes, so it stays lean: Linux runners only; lint, typecheck, test, build, and migrations in one `ci` job; npm cache on; `concurrency` with `cancel-in-progress` so a new push stops the old run; a 15-minute job timeout. `scope` and `verdicts` are small jobs that install nothing beyond Node. `verdicts` makes API calls only, and its job is skipped by an `if:` condition for any comment or review it doesn't need ([`shipping.md`](../program/shipping.md#the-verdicts-check)).
- A PR that changes only Markdown builds nothing. `ci` still reports success, through step-level `if:` conditions rather than a path filter, because a required check that never reports blocks the merge. Netlify's `ignore` command skips the build too.
- Outside the production context, `/portal-starter/dev/gallery` shows every ui render with its sample data. Each render ships a `<name>.gallery.ts` file beside it in `ui/`, and the gallery finds them all, so a ui PR is visible on its own preview before any route mounts it and never touches a shared file. Production returns 404 there.
- Every page outside the production context shows a non-dismissible banner: "DEV/preview environment. Test data only." Every page carries `noindex, nofollow`.

## Database copies for previews

A preview needs a database whose schema matches its PR, without changing the one other previews share. Each PR that needs one gets its own Neon branch. Four rules:

1. **A copy only when the PR needs one.** A PR that changes `db/**` or `server/**` gets its own Neon branch, `preview/pr-<number>`, with the PR's migrations applied to it. Its preview reads that copy. Every other preview reads `dev`.
2. **Copies get deleted.** Closing or merging the PR deletes its copy. A nightly sweep deletes any copy whose PR is closed, in case a delete was missed.
3. **Eight at a time.** Neon's free plan allows 10 branches per project: `production`, `dev`, and 8 copies. The Coordinator holds the next unit that touches `db/` or `server/` while 8 open PRs and in-flight owners already do. If Neon still refuses a copy, the workflow fails with "database copies full", and nobody retries it by hand.
4. **Copies come from `dev`, never `production`.** The workflow names `dev` as the parent and refuses any other, before and after launch.

How it works:

- `main`'s migrations reach `dev` on their own: a workflow applies them on every push to `main` that changes `db/**`. Nobody applies a migration by hand.
- The Neon and Netlify keys live in a GitHub environment that only `main` can use. The workflows that hold them run from `main`'s copy (`pull_request_target`, `push` to `main`, and `schedule`), so a PR can't change them, and they never run code from a PR. The copy workflow reads the PR's migration files as data and applies them with `main`'s migration runner.
- The workflow wires the copy into the PR's preview by setting `DATABASE_URL` and `APP_DB_LABEL` as Netlify values for the PR's branch, then starts a fresh preview build so the functions pick them up. On close it removes those values. Netlify applies a branch's values to deploy previews from that branch. The template proved functions read these values at runtime; a new app proves it again in R0.
- The dev banner shows `APP_DB_LABEL`, so a verifier sees which database a preview reached before testing.

## Staff sign-in

Staff and the Owner sign in with Microsoft Entra accounts in the app's tenant. Entra must give them the app role `PortalStarter.Staff`; the `staff` table then decides `staff` or `owner`. The session is a signed, HttpOnly cookie, signed with `APP_SESSION_KEY`. The role comes from the staff table, never from the request. No environment variable, setting, header, or query string grants or changes a role, in any context: there is no dev "acting role" switch. Tests act as a role by signing in a seeded synthetic staff account. Sign-in only works on the hosts listed in `server/auth/config.ts`; deploy previews show "sign-in isn't available on previews", and the `auth-test` branch deploy is where verifiers sign in.

## User portal

Users sign in at `/portal-starter/portal/auth/login` through a `UserSignInProvider` and land on `/portal-starter/portal`. The template ships the provider slot, the `app_user` table and directory, a separate session (`app_user_session`, signed with `APP_USER_SESSION_KEY`, which must differ from `APP_SESSION_KEY`), the portal home render, and tests that a staff session never opens the portal and a user session never opens admin. The provider is `stubUserProvider`, which answers `501` until gate G2 picks a real one. Wiring a provider is an adapter unit plus a core unit that swaps it into `server/portal/wire.ts`; neither changes the session rules.

## Units

| Unit | Lane | What |
|---|---|---|
| M00.a | config | Package, TypeScript, ESLint, test runner, Netlify build under `/portal-starter`, a hello page. Netlify Functions live in `server/functions/` (set in `netlify.toml`), not Netlify's default `netlify/functions/`, so they sit in the core lane. `netlify.toml` skips builds for Markdown-only changes. The build loads `design/tokens.css` as is. Node 22 pinned everywhere the code runs (`.nvmrc`, `engines` in `package.json`, `NODE_VERSION` in `netlify.toml`, and CI), since Netlify defaults to Node 24. A committed `.cursor/environment.json` with `"install": "npm ci"`, so every cloud agent starts with dependencies installed; secrets stay in the Cursor dashboard, never in that file. ESLint bans `console` outside `scripts/`, `@ts-ignore`, `@ts-expect-error`, and inline lint suppressions without an issue link (standing orders 36 and 37). |
| M00.b | config | CI `ci` job: lint, typecheck, test, build, migrations on a fresh Postgres. Workflow token `contents: read`. Secret scan. On a Markdown-only PR it reports success without installing anything. |
| M00.c | config | CI `scope` check: reads `program/lanes.yml`, derives the lane from changed paths, and enforces the `size` rules: 400 app lines, 800 test and fixture lines, 800 Markdown lines, test status only for listed paths, fixtures data-only, generated files regenerated and diffed. CI `red-first` check: when a PR's first commit adds tests, CI runs them at that commit and fails if none of them fail there, so a test that can't catch anything is caught. ESLint bans imports from `tests/` outside `tests/`. |
| M00.d | config | CI `verdicts` check: reads `program/lanes.yml`, plus the PR's `verify:<role>` labels, works out the required roles by risk, and matches each verdict to a verdict code the Coordinator posted and to the patch-id of the part of the diff its role covers ([`shipping.md`](../program/shipping.md#the-verdicts-check)). Skips the job for comments and reviews it doesn't need. |
| M00.e | core | Contracts: roles, the user state machine, settings keys. Generated enum and the drift check. |
| M00.f | core | Migration runner and the base tables: settings, audit, staff, and `app_user`. |
| M00.g | core | Adapter gate, `APP_KILL`, audit sink, deploy-context guard. |
| M00.h | core | Staff sign-in, session, role check, and a refusal test for every non-staff caller. A test proves that no environment variable changes a caller's role. |
| M00.i | ui | Admin renders: users list, user page, settings page, and the dev banner, which shows the database label it is given; plus the portal home. Pure renders only; no routes. Each one ships a `.gallery.ts` file with sample data. |
| M00.j | config | CI `content` check: user-facing strings in `ui/` and `server/` and `.html` outside `design/` contain no word from `program/banned-words.txt` (standing order 2). |
| M00.k | config | Run pstack's `/create-verification-skill` to generate `.cursor/skills/verify-app/`: launch, doctor, drive, evidence, cleanup, and a feature map. Proven once end to end on a deploy preview. |
| M00.l | config | CI guards: `adapter-mode` (every external call goes through the adapter gate, and CI forces `mock`); `live-key-guard` (the app refuses to start with a live key outside production, and `APP_KILL` stops every adapter); `db-guard` (outside the production context, the app refuses to start when `DATABASE_URL` points at the host in `APP_PROD_DB_HOST`, with or without Neon's `-pooler` suffix); `ci-permissions` (no workflow widens its token past `contents: read`, except `verdicts` and the database-copy workflows reading pull requests, and no workflow triggered by `pull_request` names the `neon` environment). |
| M00.m | ui | Design system: `design/tokens.css`, tokens, components, motion, contrast ratios, and the ui review checklist. |
| M00.n | config | [Database copies for previews](#database-copies-for-previews): the copy workflow, delete on close, the nightly sweep, `main`'s migrations to `dev`, and the Netlify values for the PR's branch. All of it lives under `.github/`, so it stays in the config lane. Needs M00.f and M00.p merged. |
| M00.o | core | The render gallery at `/portal-starter/dev/gallery`: finds every `ui/**/*.gallery.ts` file and shows its render with its sample data; 404 in production. Needs M00.a merged. |
| M00.p | core | Mount the M00.i renders on the admin and portal routes behind their sign-ins, and pass `APP_DB_LABEL` to the dev banner. Needs M00.h and M00.i merged. |
| M00.q | core | `scripts/init-app.ts`: renames the template to the app's name, slug, repository, and Entra ids in one run. |

## Done when

- A fresh Cursor cloud agent started on this repository can run `/poteto-mode`, which proves pstack loads from `.cursor/settings.json` in project scope. If it can't, stop and report before any other unit.
- The preview at `/portal-starter/` loads and shows the dev banner. A test proves the production context shows no banner; production itself first deploys at launch.
- `main` deploys as a Netlify branch deploy, and merges to `main` use no Netlify credits.
- A ui PR's renders show in its preview's gallery. The gallery returns 404 when `APP_DEPLOY_CONTEXT` is `production`.
- A Markdown-only PR passes `ci` without installing anything, and Netlify skips its build.
- A staff account signs in and sees the users list. A non-staff request gets 403 before any database read. A user session never opens admin, and a staff session never opens the portal.
- A PR that hides app code in `tests/`, in a `.test.ts` file outside `tests/`, or in a fixture fails `scope`. A PR whose new tests already pass before the fix commit fails `red-first`.
- `verdicts` scales to risk: a docs-only PR needs no verdict, a `server/` PR needs QA, and a `verify:qa` label adds QA to any PR.
- A PR that changes files in two lanes fails `scope` unless it carries `cross-lane`. A PR with a PASS verdict that is then updated from `main` with no patch change still passes `verdicts`. On a PR with CTO and QA verdicts, a fix that touches only `server/` keeps the CTO verdict for `db/` and needs a new QA verdict.
- A test that calls `fetch` fails CI. A banned word typed into user-facing copy fails `content`.
- A PASS verdict posted through the review app without a code matching the Coordinator's fingerprint fails `verdicts`, and so does a second fingerprint for the same role and head.
- Applying every migration twice on a fresh database leaves the same schema.
- A preview given the production database's host refuses to start (`db-guard`). Setting any role-like environment variable changes no caller's role.
- A PR that adds a migration gets `preview/pr-<number>` copied from `dev`. The migration is on the copy and not on `dev`, and the preview's banner names the copy. A ui-only PR gets no copy, and its banner says `dev`.
- Closing that PR deletes its copy and its Netlify values. A copy left behind on purpose is gone after the next nightly sweep. After a migration PR merges, the migration is on `dev` with nobody applying it by hand.
- A test PR that adds a workflow printing `NEON_API_KEY` gets nothing: the key is only reachable from `main`.
- A fresh QA verifier agent uses `verify-app` to open the preview, sign in as staff on `auth-test`, and capture a screenshot of the users list as evidence.

## R0 in a new app

The code is already here, so R0 proves it on the new app's own services. Each line is one small unit (most are config or docs only) with its proof. The Coordinator queues them in this order once [`program/setup.md`](../program/setup.md) is done.

| Unit | Lane | What | Proof |
|---|---|---|---|
| R0.a | program | Pilot: the Coordinator briefs one owner to fix a typo or add a line to `README.md`, then runs it end to end (brief, owner, CI, Shipper merge). Fix the brief template from what it shows. | The merged PR and the Coordinator's notes in `program/brief-template.md`. |
| R0.b | config | Turn on `ci`, `scope`, and `verdicts` as required checks (the Owner, [`setup.md`](../program/setup.md)), then a throwaway PR that crosses two lanes. | `scope` fails it without `cross-lane`; the required checks show on the PR. |
| R0.c | core | A tiny migration PR (for example a new settings key, added to `contracts/domain.ts` and the settings check together). | The PR gets `preview/pr-<n>`, its banner names the copy, closing it deletes the copy, and after merge the migration is on `dev`. |
| R0.d | config | Update `verify-app` patterns if the site name differs from the slug, then a QA verifier runs `hello-page`, `staff-sign-in`, and `users` on `auth-test`. | Evidence files from the run: `staff-users.png` and `nostaff-forbidden.png`. |
| R0.e | program | The R1 plan: milestone files and the `specs/releases.md` rows for R1 onward, written from the Owner's answer to gate G1. | A merged `spec/` PR the Owner approved. |

R0 is done when every line above has its proof, and the Coordinator has caught the Owner up and asked gates G12 and G13.

# Setup checklist

Everything the Owner sets up by hand for a new app built from this template, in order, before the Coordinator Bot starts. Cloud agents can't reach these dashboards. Tick each box in a PR to this file, or keep a copy outside the repository.

Rules for every step:

- **No secret value goes into this repository**, ever. Secrets go into the service's own store: Netlify env vars, the GitHub `neon` environment, Cursor cloud-agent secrets, or the Grok Bot Vault.
- **Every secret is new for this app.** Don't reuse a session key, database URL, or client secret from another app, even where the name matches.
- Anything marked **costs money** needs a dated entry in [`decisions.md`](decisions.md) first (gate G9).

Throughout, `<slug>` is the app's slug (for example `acme-portal`), and `<site>` is its Netlify site name (use the slug).

## 0. Make the repository

- [ ] On GitHub, open `daggerbourne/portal-starter` → **Use this template** → **Create a new repository**. Owner `daggerbourne`, name `<slug>`, **Private**, without other branches.
- [ ] Clone it and run the init script, which renames the template in every file:
  ```bash
  npm ci
  npx tsx scripts/init-app.ts --name "Acme Portal" --slug acme-portal --review-app <your-review-app>
  npm test
  ```
  `--review-app` is the slug of the GitHub App verifiers post verdicts through (step 1); CI only counts verdicts from that App. Add `--entra-tenant <guid> --entra-client <guid>` once step 4 gives you the ids, or set them later as Netlify env vars `APP_ENTRA_TENANT_ID` and `APP_ENTRA_CLIENT_ID`.
- [ ] Commit straight to `main` (this is the only direct push; the ruleset in step 1 stops the rest) and push.
- [ ] Create two more branches from `main` and push them: `production` (Netlify's production branch until launch) and `auth-test` (the branch deploy where sign-in works).

## 1. GitHub

- [ ] **The crew's machine account** (for example `<your-bot-account>`) already exists from earlier apps. GitHub allows one free machine account per person, so reuse it. Add it as a **collaborator** on the new repository (Settings → Collaborators) and accept the invite as the bot. Never make it an admin.
- [ ] Install **Cursor's GitHub app** on the new repository, as yourself, so cloud agents can clone it. Cursor's GitHub connection must be signed in as the machine account, not as you.
- [ ] Install the **verdict GitHub App** (the one you named with `--review-app`) on the new repository. Verifiers post verdicts through it. If you don't have one yet, create a GitHub App owned by you with repository permissions Pull requests read and write, Contents read, Metadata read, and nothing else (never Administration), no webhook, installable only on your account. One App can serve every app you build from this template. Its id and a private key are Cursor secrets (step 6).
- [ ] Settings → General → Pull Requests: allow **squash merging only**.
- [ ] Settings → Rules → Rulesets → new branch ruleset named `main`: enforcement Active, bypass list empty, targets the default branch and `production`; restrict deletions; block force pushes; require a pull request with **0** approvals, "Require review from Code Owners" **on**, "Dismiss stale approvals" **on**, "Require approval of the most recent reviewable push" **off**. Leave status checks for step 8.
- [ ] Settings → Environments → new environment **`neon`**. Deployment branches: `main` only. Fill it in step 3.

## 2. Netlify

- [ ] Import the repository as a new Netlify project named `<site>`. The publish directory comes from `netlify.toml` (`dist`).
- [ ] Project configuration → Build & deploy → Continuous deployment:
  - production branch: **`production`**;
  - branch deploys: **`main` and `auth-test`** only;
  - deploy previews: on, for pull requests into `main`.
- [ ] Visitor access: previews must open for verifier agents. Either Public (and turn protection back on before go-live, gate G10), or a password given to agents as the Cursor secret `APP_PREVIEW_PASSWORD`.
- [ ] Leave Netlify's built-in database feature **off**. It gives every preview a copy of production data.
- [ ] Note the **site ID** for step 3.
- [ ] Environment variables, per deploy context. Netlify functions can't see Netlify's own `CONTEXT`, so the app reads `APP_DEPLOY_CONTEXT`:

  | Variable | Production | Branch deploys and previews | Secret? |
  |---|---|---|---|
  | `APP_DEPLOY_CONTEXT` | `production` | `dev` | no |
  | `MODE` | `mock` until launch | `mock` | no |
  | `APP_DB_LABEL` | `production` | `dev` (CI overrides it per PR copy) | no |
  | `APP_PROD_DB_HOST` | the Neon `production` endpoint host, without `-pooler` | same value | no |
  | `DATABASE_URL` | pooled URL of Neon `production` | pooled URL of Neon `dev` | yes |
  | `APP_SESSION_KEY` | new random 64-byte value | a different random value | yes |
  | `APP_USER_SESSION_KEY` | new random value, different from `APP_SESSION_KEY` | a different random value | yes |
  | `APP_ENTRA_CLIENT_SECRET` | from step 4 | same | yes |
  | `APP_ENTRA_TENANT_ID`, `APP_ENTRA_CLIENT_ID` | only if init didn't write them | same | no |

  Make random keys with `openssl rand -base64 64`. The app refuses to start outside production if `DATABASE_URL` points at `APP_PROD_DB_HOST`, and the portal refuses to run if the two session keys are equal.
- [ ] Turn auto recharge **off** unless you approve the spend. Every production deploy costs Netlify credits, and running out pauses every site on the team, so `main` stays a free branch deploy until launch.

## 3. Neon

- [ ] Create a Neon project for this app (free plan): Postgres 17 or later, the region nearest the Netlify functions. Rename the default branch **`production`**, then create **`dev`** from it while it's empty.
- [ ] **Reset the `neondb_owner` password on `dev`** (the `dev` branch → Roles). A new branch keeps its parent's password, so until you do, a dev connection string also opens production.
- [ ] Copy into Netlify (step 2): the pooled `production` URL, the pooled `dev` URL, and the production endpoint host for `APP_PROD_DB_HOST`.
- [ ] Create a Neon API key, limited to this project if Neon allows it.
- [ ] Fill the GitHub **`neon`** environment (step 1). Only workflows running from `main` can read it, so no PR can:
  - secrets: `NEON_API_KEY`, `NETLIFY_AUTH_TOKEN` (a Netlify personal access token), `APP_DEV_DATABASE_URL` (the **direct, unpooled** `dev` URL for `neondb_owner`, which runs migrations);
  - variables: `NEON_PROJECT_ID`, `NETLIFY_SITE_ID`.
- [ ] The free plan allows 10 branches: `production`, `dev`, and 8 PR copies. A paid plan with protected branches is part of gate G9 for launch.

## 4. Microsoft Entra (staff sign-in)

- [ ] Entra admin center → App registrations → **New registration**, named `<slug>`, single tenant. Note the **tenant id** and **client id**.
- [ ] Authentication → Web → redirect URIs, all four:
  - `https://<site>.netlify.app/<slug>/auth/callback`
  - `https://main--<site>.netlify.app/<slug>/auth/callback`
  - `https://auth-test--<site>.netlify.app/<slug>/auth/callback`
  - `http://localhost:8888/<slug>/auth/callback`

  These must match `ENTRA_REDIRECT_URIS` in `server/auth/config.ts`, which init wrote from the slug. If the site name differs from the slug, edit that file to match.
- [ ] Certificates & secrets → new client secret → Netlify `APP_ENTRA_CLIENT_SECRET` (step 2). Note its expiry date.
- [ ] App roles → create **`<PascalName>.Staff`** (for example `AcmePortal.Staff`; init wrote the exact name into `server/auth/staff-sign-in.ts`), allowed member type Users/Groups.
- [ ] Enterprise applications → `<slug>` → Users and groups: give the staff role to yourself and to staff.
- [ ] Two **synthetic test accounts** for verifiers: one **with** the staff role, one **without**. Give each a password and an authenticator setup key (base32), and keep both out of this repository.
- [ ] Make yourself the owner in the app's `staff` table on `dev` (and on `production` at launch). Run this in the Neon SQL editor once the first migration has reached `dev`. The table only sets the role; Entra still has to grant the staff role:
  ```sql
  INSERT INTO staff (entra_object_id, email, display_name, role, created_by)
  VALUES ('<your Entra object id>', '<your email>', '<your name>', 'owner', 'setup');
  ```
  Anyone with the Entra staff role and no row signs in as `staff`, so only the owner needs a row.

## 5. User sign-in

- [ ] Nothing to set up yet. The portal's sign-in is a stub that answers `501` until gate G2 picks a provider. The unit that wires the provider lists its own setup lines here.

## 6. Cursor (cloud agents)

- [ ] Cursor dashboard → Integrations: GitHub connected as the **machine account** with access to this repository.
- [ ] Cloud-agent secrets for this repository:
  - `APP_REVIEW_APP_ID` and `APP_REVIEW_APP_KEY`: the verdict App's id and a private key (a GitHub App can hold several keys, so other apps can keep theirs);
  - `APP_TEST_STAFF_EMAIL`, `APP_TEST_STAFF_PASSWORD`, `APP_TEST_STAFF_TOTP`;
  - `APP_TEST_NOSTAFF_EMAIL`, `APP_TEST_NOSTAFF_PASSWORD`, `APP_TEST_NOSTAFF_TOTP`;
  - `APP_PREVIEW_PASSWORD`, only if previews are password-protected.
- [ ] `.cursor/environment.json` already runs `npm ci` for every agent, and `.cursor/settings.json` already loads pstack and `cursor-team-kit`. Nothing to change.
- [ ] Set a cloud-agent spend limit when Cursor asks the first time.

## 7. Prove the identity setup

- [ ] At cursor.com/agents, start a cloud agent on the repository: "Make a branch named `cfg/identity-test`, add `.github/identity-test.txt` containing the word test, open a ready PR titled Identity test, then stop."
- [ ] Check: the PR's author is the **machine account**, its Netlify preview builds, and GitHub blocks the merge until you approve it as yourself (it touches `.github/`, a code-owner path).
- [ ] Close it unmerged and delete the branch.

## 8. Required checks

- [ ] Once `ci`, `scope`, and `verdicts` have each run once on a PR, add all three as **required status checks** in the `main` ruleset. Leave "require branches to be up to date" **off**.

## 9. Grok Bots

- [ ] Follow [`kickoff.md`](kickoff.md): build the Coordinator and the Designer with Dr. Eggbot, connect GitHub as the machine account for this repository only, check Cloud Agents is on, add the two routines and the always-allow rule, then paste the kickoff prompt.

## While the crew runs

Two limits can stall the crew without anyone noticing: GitHub Actions minutes (private repositories use your plan's monthly allowance) and Netlify credits. When either runs out, CI or previews stop reporting and every agent waits. Check both once a week.

## Before each release that needs it

The Coordinator adds a row here for each release that needs hand setup (a vendor sandbox account, an API key, a DNS record), with whether it costs money.

| Release | Setup | Costs money |
|---|---|---|
| Launch | Everything in gates G9 and G10: Neon plan with protected branches, preview protection back on, Netlify production switched to `main`, the public domain or path, `MODE=live` in production only, and the owner row in the production `staff` table. | Yes |

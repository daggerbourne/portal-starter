# Portal Starter

A starting point for a web app with two sides: a **user portal** where people sign in and see their own data, and a **staff admin** where staff sign in with Microsoft and run the app. It runs on GitHub, Netlify, and Neon, and it is built to be extended by a bot crew: Grok Bots plan and coordinate, and fresh Cursor cloud agents write and verify every change.

Everything a new app normally spends its first release on is already here and tested: CI with lane, size, and verdict checks; a Neon database copy for each PR preview; an adapter gate with a kill switch and audit rows; startup guards that keep previews off the production database; staff sign-in; a user portal with its own session; a render gallery for ui work; and a verification skill that drives the deployed site.

## Start a new app

1. **Use this template** on GitHub to make a private repository, then rename everything in one command:
   ```bash
   npm ci
   npx tsx scripts/init-app.ts --name "Acme Portal" --slug acme-portal --review-app <your-review-app>
   npm test
   ```
2. Work through the checklist in [`program/setup.md`](program/setup.md): GitHub, Netlify, Neon, Entra, Cursor, and the Grok Bots.
3. Paste [`program/kickoff.md`](program/kickoff.md) into the new Coordinator Bot. Its first job is R0, which proves the foundation on your services and turns your product brief into the R1 plan.

In this template repository itself, the `db-dev-migrate` workflow fails on purpose: there is no Neon environment here, and the workflow refuses to run without one. It passes in an app once [`program/setup.md`](program/setup.md) step 3 is done.

## What's built

| Area | Where | What it does |
|---|---|---|
| Staff admin | `/portal-starter/admin` | Microsoft Entra sign-in, a users list and user page, and an owner-only settings page. |
| User portal | `/portal-starter/portal` | A separate user session and a portal home. The sign-in provider is a stub (`501`) until gate G2 picks one: magic link, Entra External ID, Google, or Neon Auth. |
| Render gallery | `/portal-starter/dev/gallery` | Every ui render with sample data, outside production only. |
| Data | `db/`, `contracts/` | Timestamped, idempotent migrations; `staff`, `app_user`, `settings`, `audit`; enums generated from the contracts, with a drift check. |
| Guards | `core/` | `MODE=mock|sandbox|live` adapter gate, `APP_KILL`, and a startup guard that refuses a preview pointed at production. |
| CI | `.github/` | `ci`, `scope`, `verdicts`, `content`, `guards`, and the Neon database-copy workflows. |
| Verification | `.cursor/skills/verify-app/` | Drives the deployed site, signs in on `auth-test`, and saves evidence. |

## Where things live

| Path | What it is | Who changes it |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | What every agent and Bot reads first | Coordinator, with the Owner's approval |
| [`program/`](program/) | How work happens: standing orders, roles, lanes, shipping, briefs, gates, decisions, setup, kickoff | Coordinator. The Owner approves the rule files and decisions on GitHub ([`.github/CODEOWNERS`](.github/CODEOWNERS)). |
| [`specs/`](specs/) | What we build: the domain model, one file per milestone, and the release order in `specs/releases.md` | Coordinator |
| [`design/`](design/) | Tokens, components, motion, and the ui review checklist | Designer Bot's agents |

## Rules that hold everywhere

1. If it isn't on `main` in this repository, it doesn't exist. A brief may cite only files on `main`. Bot memory is never a source of facts.
2. [`program/standing-orders.md`](program/standing-orders.md) is the only list of standing rules. Other files link to it. They don't restate it.
3. [`program/lanes.yml`](program/lanes.yml) is the only lane map. CI and people read the same file.
4. The Owner's decisions count only once they're written in [`program/decisions.md`](program/decisions.md).

## The crew

| Layer | What | How many |
|---|---|---|
| Grok Bots | The **Coordinator** (plans, briefs, queue) and the **Designer** (owns the ui lane and its memory). Both built by Dr. Eggbot. | 2. More only through gate G12. |
| Cursor cloud agents | Fresh for every job: owners write code, verifiers check it, a Shipper per batch merges. | As many as the work needs, 6 owners at once. |

The Owner talks only to the Coordinator. On GitHub the crew works as one machine account, so GitHub can tell its work from the Owner's approvals. Details are in [`program/roles.md`](program/roles.md).

## Method

The crew works with [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan ([@poteto](https://x.com/poteto)), and its Bots are built with her Dr. Eggbot. Every cloud agent starts with `/poteto-mode`. [`AGENTS.md`](AGENTS.md) says which playbook each role runs.

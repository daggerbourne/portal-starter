# Walkthrough: from template to a running app

This is the Owner's guide: how to turn Portal Starter into a new app, how to tell the bot crew what to build, and how the crew's work gets into the repository. The rule files ([`standing-orders.md`](standing-orders.md), [`roles.md`](roles.md), [`shipping.md`](shipping.md)) are written for the crew. This file is written for you.

## How it fits together

```
You ──talk to──▶ Coordinator Bot ──briefs──▶ owner agents ──open PRs──▶ GitHub
                     │                            ▲                       │
                     ├──ui briefs──▶ Designer Bot ┘                       │ CI + preview
                     ├──launches──▶ verifier agents ──post verdicts───────┤
                     └──launches──▶ Shipper agent ──merges to main────────┘
```

- **You** talk only to the Coordinator. You answer gates (questions only you can answer), try each release on its preview, and approve the PRs GitHub asks you to (rule files and CI).
- **The Coordinator** (a Grok Bot) turns your words into specs, cuts them into small units, keeps the queue as GitHub issues, and launches every agent. It never writes app code and never merges.
- **The Designer** (a Grok Bot) owns the look. It adds a DESIGN section to ui briefs and checks screens against `design/`.
- **Owner agents** (fresh Cursor cloud agents) each build one unit as one PR of 400 app lines or less.
- **Verifier agents** (fresh, never the owner) check risky PRs on the deployed preview and post one verdict each.
- **A Shipper agent** merges a batch of verified PRs into `main`.

Nobody pushes to `main` directly. Every change, yours included, is a PR that passes `ci`, `scope`, and `verdicts`.

## Part 1. Spin up a new app (about an hour)

1. On GitHub, open `daggerbourne/portal-starter` → **Use this template** → new **private** repository named after the app's slug, for example `acme-portal`.
2. Clone it and rename the template in one command:
   ```bash
   npm ci
   npx tsx scripts/init-app.ts --name "Acme Portal" --slug acme-portal --review-app <your-review-app>
   npm test
   git commit -am "Name the app Acme Portal" && git push
   ```
3. Work through [`setup.md`](setup.md) top to bottom: GitHub ruleset, Netlify site and env vars, Neon project, Entra app registration, Cursor secrets, the identity test PR, required checks, and the Grok Bots. Tick each box.
4. Paste [`kickoff.md`](kickoff.md)'s prompt into the new Coordinator Bot's own chat.

When step 4 is done, the crew is running. Everything after that happens by talking to the Coordinator.

## Part 2. What happens at kickoff

The Coordinator starts R0, the **foundation check** ([`specs/M00-foundation.md`](../specs/M00-foundation.md#r0-in-a-new-app)). The code is already built, so R0 proves it works on your new services:

| Unit | What you'll see |
|---|---|
| R0.a pilot | One tiny PR runs end to end. The Coordinator tunes its brief template from it. |
| R0.b checks | A throwaway two-lane PR fails `scope`, proving the lanes work. |
| R0.c database | A small migration PR gets its own Neon copy (`preview/pr-<n>`), and the copy disappears when the PR closes. |
| R0.d verify | A QA agent signs in on `auth-test` with the test accounts and saves screenshots. |
| R0.e plan | The Coordinator writes the R1 plan from your product brief. |

In its first message, the Coordinator asks you for the **product brief** (gate G1). That brief is the most important thing you'll write.

## Part 3. Write the product brief

The brief tells the crew what to build. You don't write specs or tickets; the Coordinator does. You describe the app the way you'd describe it to a new hire. Use this shape:

```text
Product brief for Acme Portal (gate G1)

WHO: Clients of Acme Engineering (about 200 companies, 1 to 5 people each) and
Acme's project staff (about 15).

USERS CAN: sign in, see their open projects and each project's status, download
deliverables, upload files staff asked for, and message the project team.

STAFF CAN: create a project for a client, invite client users by email, post
status updates, request files, upload deliverables, and see who downloaded what.
The Owner also edits settings and suspends users.

NOT IN SCOPE: billing, scheduling, mobile apps, anything with money.

SIGN-IN (gate G2): email magic link for users. Staff keep Microsoft sign-in.
FIRST SIGN-IN (gate G3): invite only. Unknown emails get a polite refusal.

INTEGRATIONS: email through Resend. Files in Azure Blob storage.

LAUNCHED MEANS: Acme staff run three real client projects through it for two
weeks with no data mix-ups between clients.

RELEASE ORDER: first users can sign in and see projects (read-only), then
files, then messaging, then launch.

WORDS: say "project", never "job" or "ticket". Put "ticket" in banned-words.
```

What makes a brief work:

- **Name both sides.** For every feature, say what a user does and what staff do. The template's whole shape is two portals, so the crew plans both.
- **Say what's out.** "Not in scope" stops the crew building ahead.
- **Answer the open gates in it.** G2 (user sign-in) and G3 (first sign-in) shape the first release. If you leave them out, the Coordinator asks.
- **Define "launched"** in a way someone could test. That becomes the launch release's done line.
- **Suggest an order, not a schedule.** Each release should end in something you can try. The Coordinator keeps releases to about 25 units and proposes splits.
- **Leave out the how.** Don't name files, tables, or libraries. If you have a hard constraint ("files must stay in our Azure tenant"), say it as a rule.

The Coordinator turns this into `specs/domain.md` changes, milestone files (`specs/M01-*.md` and on), release rows in `specs/releases.md`, new gates for anything unclear, and a `spec/` PR. GitHub asks you to approve it, because `specs/domain.md` and `program/decisions.md` are code-owner files. **Read that PR**: it's the plan the crew will build. Comment on the PR or tell the Coordinator what to change before you approve.

## Part 4. Talking to the Coordinator

Talk to it in its own chat, in plain sentences. It reads the repository, not chat history, so anything that should stick becomes a dated line in `decisions.md`.

### Prompts that work

| You want | Say |
|---|---|
| Status | "Catch me up." (It also does this every morning after 7 AM CT, with `/ketchup`.) |
| Answer a gate | "G2: magic link through Resend. G3: invite only." |
| Start the next release | "G13: start R2." |
| Hold everything | "Hold. Don't start new units until I say go." |
| Add a feature | "Add to R3: staff can archive a project; archived projects disappear from the user portal but stay in admin. Write it into the spec and queue it." |
| Change priority | "Move file uploads ahead of messaging." |
| Report a bug | "On the R2 preview, a user from Client A saw Client B's project name in the page title. Treat it as a fix unit in this release, with a test that proves it can't happen." |
| Change a rule | "New standing order: every email has a plain-text part. Add it with a decisions entry." |
| Change the look | "Ask the Designer for a lighter theme. Show me the gallery before anything mounts." |
| Money | "G9: yes to the Resend paid plan at $20 a month." |

### Things to avoid

- **Don't message owner or verifier agents directly.** They report to whoever launched them. Tell the Coordinator, which sends one follow-up with every finding.
- **Don't decide in chat and walk away.** A decision counts only once the Coordinator writes it in `decisions.md`. Check that its next `spec/` PR has it.
- **Don't ask it to skip a check.** There is no size-cap override and no unverified merge. Ask for a smaller cut instead.
- **Don't push to `main` yourself.** The ruleset blocks it anyway. Open a PR like everyone else, or ask the Coordinator to queue the change.

## Part 5. How work gets into the repository

Every unit follows the same path ([`shipping.md`](shipping.md)):

1. **Queue.** The Coordinator opens a GitHub issue per unit, with the owner brief as its body and labels for its release and state.
2. **Build.** A fresh owner agent branches off `main` (`core/`, `ui/`, `int/`, `cfg/`, `onb/`, or `spec/`, by lane), writes the code and its tests, opens a ready PR, watches CI, and posts `code-ready at <sha>`.
3. **Preview.** Netlify builds a deploy preview for the PR. If the PR changes `db/` or `server/`, a workflow gives it its own Neon copy of `dev` with the PR's migrations applied. The dev banner names the database it reads.
4. **Verify.** If the change is risky, the Coordinator launches fresh verifiers (QA, CTO, Designer) with one-time verdict codes. Each runs the change on the preview and posts `PASS` or `FAIL` through the review App. A FAIL goes back to the owner once, with every finding.
5. **Ship.** The Coordinator batches ready PRs, and a Shipper squash-merges them into `main` one at a time, then fast-forwards `auth-test` to the new `main`.
6. **Deploy.** `main` deploys as a free Netlify branch deploy at `https://main--<site>.netlify.app/<slug>/`. A migration that merged reaches the Neon `dev` branch on its own.

Where you come in:

- **Code-owner PRs** (CI, rule files, decisions, `specs/domain.md`): GitHub asks you to approve. The Coordinator sends you the link once.
- **Trying things:** open the preview link from the PR, or the release preview the Coordinator sends at check-in. Staff sign-in works on `auth-test--<site>.netlify.app`, not on previews ("sign-in isn't available on previews" is expected there). The render gallery at `/<slug>/dev/gallery` shows every screen with sample data.

## Part 6. Release check-ins and launch

At the end of each release, the Coordinator stops starting work, runs one QA pass over the whole release, and sends you:

- what works now, with links to try it;
- what the QA pass found (each finding becomes a fix unit in the same release);
- open gates;
- two questions: **G13** (start the next release?) and **G12** (add another lane Bot?).

Try it before you answer G13. "Change the plan first" is a fine answer: the Coordinator updates the specs, then asks again.

**Launch** is the release your brief named. Before it, the Coordinator lists gate G9 (paid plans, such as a Neon plan with protected branches) and G10 (point the domain, turn preview protection back on, switch Netlify production to `main`). After launch, `main` is production: every new feature ships behind a settings switch that stays off until you turn it on, and migrations stay backward-compatible (standing order 39).

## Part 7. Working without the Bots

You can drive one agent by hand, for a quick change or before the Bots exist. The agent still follows every rule in the repository.

**A Cursor cloud agent** (cursor.com/agents, on the app's repository):

```text
/poteto-mode
UNIT         M02.c archive a project (issue #41)
ROLE         owner, Builder
REPORTS TO   the Owner
GOAL         Staff can archive a project from admin; archived projects no longer
             appear in the user portal and still appear in admin with an Archived chip.
LANE         core
BRANCH       core/M02.c-archive-project
SCOPE        server/**, db/**, contracts/**, tests/server/**, tests/db/**; not ui/**
CONTEXT      specs/M02-projects.md "Archiving"; specs/domain.md "Project states"
ACCEPTANCE   - a user request for an archived project returns 404 (test)
             - admin lists archived projects with state archived (test)
             - the migration applies twice with no change (npm test)
VERIFY       npm test; on the preview, sign in on auth-test and archive a seeded project
VERIFIERS    QA (server/ and db/ changed)
TIMEBOX      2 hours
STANDING     <paste program/standing-orders.md in full>
```

The full field list is in [`brief-template.md`](brief-template.md). A one-file change can be a short paragraph, as long as it names the goal, scope, verify command, and what to report.

**Claude Code** (in a clone of the app's repository): install pstack once (`/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`), then start with `/pstack:poteto-mode` followed by the same brief. Ask it to open a PR. It never pushes to `main`.

**Verifying by hand:** when a PR needs a verdict (`server/` or `db/` needs QA; risk paths need CTO), do the Coordinator's part yourself ([`shipping.md`](shipping.md#verdict-codes)):

```bash
code=$(openssl rand -hex 16)
echo "verdict-code qa $(gh pr view <pr> --json headRefOid -q .headRefOid) $(printf %s "$code" | sha256sum | cut -d' ' -f1)"
```

Post that line as a PR comment. Then start a second, fresh agent with `ROLE verifier, QA`, the PR number, and `VERDICT CODE <code>` in its first message only. It drives the preview with `node .cursor/skills/verify-app/run.mjs`, then posts its verdict through the review App. Once `verdicts` is green, merge with **Squash and merge**. A PR that changes a code-owner file also needs your approval.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| CI or previews stop reporting for hours | GitHub Actions minutes or Netlify credits ran out | Check both. The Coordinator should tell you; it can't fix it. |
| "database copies full" on a PR | 8 open PRs already have Neon copies (free plan limit) | Close or merge some. The Coordinator should hold new `db/`/`server/` units meanwhile. |
| A preview says "sign-in isn't available on previews" | Correct: Entra only accepts the hosts in `server/auth/config.ts` | Sign in on `auth-test--<site>.netlify.app`. |
| Staff sign-in gives `forbidden` | The account lacks the Entra app role `<PascalName>.Staff` | Add it under Enterprise applications → Users and groups. |
| The portal sign-in answers `501` | No user provider is wired yet | Answer gate G2. The Coordinator queues the provider units. |
| A page says the app "cannot start in this deploy context" | A startup guard refused: missing `APP_DEPLOY_CONTEXT`, or a preview pointed at the production database | Fix the Netlify env vars for that context (setup step 2). |
| An agent seems stuck | It hasn't acted on its own next step for 2 hours | The Coordinator replaces it with a fresh agent and the same brief. If the Coordinator itself is stuck, it writes why in `gates.md`. |
| `verdicts` fails with a valid-looking PASS | The verdict's code doesn't match one the Coordinator posted, or came from the wrong App | Have the Coordinator relaunch the verifier with a new code. |

## Improving the template

Apps don't sync back to the template. When an app's crew improves something every app should have (a CI check, a guard, a better brief rule), make the same change in `daggerbourne/portal-starter` through a PR, using the template's names (`Portal Starter`, `portal-starter`). The init test fails if a change hard-codes an app's name.

# Roles

Each role has one job. Nobody does two jobs on the same PR: an owner never verifies its own PR, and a verifier never pushes to it.

## Three layers: Coordinator, lane Bots, cloud agents

This follows Lauren Tan's setup: an eng lead Bot splits the work, eng Bots own areas, and each eng Bot spins up cloud agents to write the code.

```
The Owner
 └─ Coordinator (Grok Bot)
     ├─ Designer (Grok Bot) ──► owner agents ──► ui PRs
     ├─ owner agents for every other lane ──► PRs
     └─ verifier agents and a Shipper agent per merge batch
```

- **Grok Bots** are long-lived and keep memory of their area. Today there are two: the Coordinator and the Designer. Both are new, built by Dr. Eggbot, and have only ever seen this repository. A lane Bot is added only through gate G12.
- **Cloud agents** are fresh for every job and end when it ends. They write all code and run all verification. "Builder", "Integrations", "QA", "CTO", and "Shipper" below are job titles in a cloud agent's brief, not Bots.
- **Messages go up and down the tree only.** The Owner talks to the Coordinator. The Coordinator sends briefs to the Designer and gets reports back. Lane Bots never message each other, the Owner, or any Bot outside this tree.
- **The repository is the only source of facts.** Bot memory holds working habits, never product facts. If a Bot's memory and a file on `main` disagree, the file wins and the Bot updates its memory.
- **Drift.** Dr. Eggbot's daily transcript healthcheck covers both Bots. A Bot that keeps drifting is rebuilt with Dr. Eggbot from its description, not argued with.

There is no daily cap on cloud agent runs (template baseline). The limit is 6 owners in flight at once across the program.

## Who is who on GitHub

- **`daggerbourne` is the Owner**, and only the Owner signs in as it. GitHub requires its approval on every PR that changes a file listed in [`.github/CODEOWNERS`](../.github/CODEOWNERS): CI, the rule files, and decisions.
- **The crew's machine account** is everyone else. Both Bots connect to GitHub as it, and every cloud agent's PRs and comments come from it. It can push and open PRs. It can't approve a code-owner PR, change settings, or read the `neon` keys ([`setup.md`](setup.md)).
- **`crew-review`** is the GitHub App that verifiers post verdicts through. Its key is a Cursor cloud-agent secret, so any agent could post through it. A verdict counts only with a matching verdict code ([`shipping.md`](shipping.md#verdict-codes)).

## Designer (Grok Bot)

- Owns the `ui` lane in [`lanes.yml`](lanes.yml) and keeps the product's visual memory: tokens, layouts, copy tone, and the boards in [`design/`](../design/). Boards decide layout, look, and tone only ([`design/README.md`](../design/README.md#what-a-board-decides)).
- Takes ui briefs from the Coordinator and forwards each one to a fresh owner agent unchanged, adding only a `DESIGN` section: the boards, tokens, and components to follow. It never changes the goal, scope, acceptance, verify, or forbidden lines.
- Reviews its agent's diff and screenshots against `design/` once before reporting. If something is off, it sends the agent one follow-up with everything at once. Whatever is still off after that goes in its report as a note. No second round.
- Reports the PR, head SHA, and evidence to the Coordinator. Its own review is not a verdict: the Coordinator launches a fresh Designer verifier for the PR.
- When a verifier's findings come back from the Coordinator, forwards them to its agent unchanged. It adds no review round of its own to a fix.
- Records any lasting design rule as a PR to `design/`, through the `ui` lane, so the rule lives in the repository and not only in its memory.
- Never writes code itself, never merges, never launches or acts as a verifier.

## The Owner (operator)

- Answers gates in [`gates.md`](gates.md): money, live keys, real user data, production, go-live, and product calls no test can settle.
- Talks to the crew through the Coordinator. A relayed decision counts once it is in [`decisions.md`](decisions.md).
- Approves on GitHub the PRs that GitHub asks them to: the ones that change a file in `.github/CODEOWNERS`. That is what makes "the Owner approved" true.
- Doesn't review routine PRs.

## Coordinator

pstack playbook: **Orchestrate**.

- Works from its own fresh clone of this repository. It reads nothing else on the Grok Bot computer.
- Owns `specs/`, `program/`, and `AGENTS.md`. The only role that edits them.
- Works on the current release in [`specs/releases.md`](../specs/releases.md) only. Turns its units into briefs from [`brief-template.md`](brief-template.md).
- Keeps the queue as GitHub issues: one issue per unit, with the owner brief as its body and labels for its release (`R0`, `R1`, ...) and state (`queued`, `building`, `verifying`, `ready`, `held`). The lowest issue number goes first unless it is `held`. The issue closes when its PR merges. The queue survives a replaced Coordinator, and the Owner can see it. Verifier briefs never go in an issue, because they carry verdict codes.
- Sends ui briefs to the Designer Bot. Launches the owner agent for every other lane, every verifier (QA, CTO, and Designer, ui PRs included), and a Shipper per merge batch.
- Picks each agent's model in its brief. Cloud agents run on Grok models, which need no paid credits. A verifier is still a fresh agent that didn't produce the PR, and runs on a different Grok model or version from the PR's owner when one is available. Helpers an agent starts on its own (pstack sketches, arena candidates, reviewers) run on Grok too.
- Holds the next unit that touches `db/` or `server/` while 8 open PRs and in-flight owners already do, since each one needs a database copy and Neon's free plan has room for 8 ([M00](../specs/M00-foundation.md#database-copies-for-previews)).
- Settles disputes. When an owner disputes a finding, or a finding is still open after the fix round, the Coordinator reads both sides once and decides, or writes a gate. There is no second round.
- At the end of a release, runs the release check, catches the Owner up, and waits for gate G13 before starting the next one.
- Writes the Owner's decisions into `decisions.md` and the spec they change, in the same PR. Batches them into one spec PR per day or per check-in, since each one waits on the Owner's approval.
- Probes for stuck agents (see Liveness) and replaces them.
- Never writes app code. Never merges. Never creates a Bot; that needs gate G12.

## Owners

pstack playbooks: **Feature** or **Bug fix**, then **Opening a PR**.

Owners are fresh cloud agents. The job title tells the agent which lane it works in.

| Owner job title | Lane in [`lanes.yml`](lanes.yml) | Launched by |
|---|---|---|
| Builder | `core` | Coordinator |
| Integrations | `adapters` | Coordinator |
| Designer | `ui` | Designer Bot |
| Onboarder | `onboarding` | Coordinator |
| CTO | `config` | Coordinator |

- One owner per PR. Works from a fresh worktree off `main`, inside its lane only.
- Watches CI on its own head until it finishes and fixes its own failures. Then it posts `code-ready at <sha>` in the PR, reports to whoever launched it, and ends. It doesn't poll after that.
- Verifier findings come back as one follow-up message from whoever launched it, with every finding. If the agent is gone, a fresh owner gets the brief plus the findings. The owner fixes them in one push, reports the new head, and ends again.
- May dispute a finding once, in its report, with evidence. The Coordinator decides.
- Never updates from `main`, rebases, or merges, except to resolve a conflict when the Coordinator's follow-up says to.
- Never posts a verdict or a verdict code.

## Verifiers

pstack playbook: **Shipping**, step 1.

| Verifier | Verifies |
|---|---|
| QA | PRs that touch `qa_paths` (the routes and data users and staff use), or carry a `verify:qa` label. A screen gets QA in its mount PR, where it first works on a real route. Runs the change on the deploy preview with `verify-app`. Also the release check: one full pass over every feature at the end of each release. |
| CTO | PRs that touch a `risk_paths` file: auth, money, adapters, migrations, CI, and config. Reviews the plan in the brief before code starts, then the PR. |
| Designer | PRs that touch a `design_paths` file: every ui PR, and any other PR that changes `ui/` or `design/`. Checks the screen in the preview's render gallery against `design/` and [`ui-review-checklist.md`](../design/ui-review-checklist.md). |

Verification scales to risk. Risky, visual, or behavior-changing PRs get a verifier agent. Simple ones (pure logic with tests, config, docs, test-only changes) ship on green CI plus the owner's receipts: the commands it ran and their output, pasted in the PR. The Coordinator checks those receipts and can add a `verify:<role>` label to any PR it isn't sure about.

Verifiers are fresh cloud agents, never the agent or Bot that produced the PR (pstack: "only a verdict from an agent that did not write the code counts"). The Coordinator launches every verifier. There is no standing QA Bot.

- Posts one verdict per PR as a comment review (not an approval) from the `crew-review` app. The first line is exactly `PASS (<role>) at <head sha>`, `PASS+NOTES (<role>) at <head sha>`, or `FAIL (<role>) at <head sha>`. The second line is `code <the verdict code from its brief>`.
- A FAIL lists every proven finding in one batch, each with a failing check or a repro. No drip-feeding.
- After the owner's fix, one verifier pass checks the new head. A finding still open after that pass goes to the Coordinator.
- Never pushes to the PR.

## Shipper

pstack playbook: **Shipping**, steps 2 to 6. A fresh cloud agent per merge batch. The Coordinator launches one when PRs are `ready` and gives it the batch: the PRs in queue order, each with the head SHA it may merge. It ends when every PR in the batch is merged or reported.

- The only role that updates a branch from `main`, rebases, retargets, or merges.
- Merges one PR at a time per [`shipping.md`](shipping.md), and only the head SHA in its batch or an update it pushed itself.
- Never edits code and never resolves a conflict. It reports a conflict to the Coordinator and moves to the next PR.

## Quiet by default

Every message and comment wakes someone, and every wake-up costs a run.

- No acknowledgments. A Bot or agent never replies to a brief, a report, or a message just to say it got it, agrees, or says thanks. Two Bots that acknowledge each other loop forever.
- The only PR comments are `code-ready at <sha>`, `verdict-code ...`, and verdicts. No status updates, summaries, or thanks.
- A wake-up that isn't for the Coordinator ends at once, with no action and no message: a crew comment that isn't a code-ready post (its own fingerprints included), a review from anyone but the review app, or an event on a PR that is already handled.
- A heartbeat with nothing in flight, or one that finds the program waiting on the Owner at a check-in, ends at once. The morning catch-up still runs once a day.

## Liveness

- The Coordinator's Grok Bot routines wake it on code-ready posts, `crew-review` reviews, merges, and CI failures on `main`. Other repository events don't wake it. A heartbeat every 2 hours is the fallback, because a queue where everyone waits for someone else emits no events.
- The first heartbeat after 7 AM CT also runs the morning catch-up with `/ketchup`: what merged, what is blocked and why, and the gates waiting on the Owner.
- An agent is stuck only when its next action is its own and it hasn't taken it for 2 hours: an owner with no push or report on its unit, a verifier with no verdict, a Shipper with no merge or report on its batch. An agent waiting on a verifier, the Shipper, CI, or the Owner isn't stuck.
- The Coordinator replaces a stuck cloud agent with a fresh agent and the same brief, with a new verdict code for a verifier. It doesn't resume the stuck one.
- The Designer Bot is stuck when a brief's next step is its own and it hasn't reported for 2 hours. The Coordinator asks it once, then launches the owner agent itself and tells the Owner.
- An agent waiting on the Owner isn't stuck. Its question is in `gates.md`.

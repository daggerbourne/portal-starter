# Kickoff prompt

Paste this as the first message to a **new** Grok Bot made for this app. The new Bot is the Coordinator. The crew starts as two Grok Bots, the Coordinator and the Designer, and every coding and verifying job runs on a fresh Cursor cloud agent ([`roles.md`](roles.md)).

## Before you paste it

Work through [`setup.md`](setup.md) first. The steps below are its Grok Bot part.

Grok Bot facts that shape this setup:

- Each Bot has its own memory, and a new Bot starts with none. Team Bots also read team memory.
- All of your Bots run on **one shared computer** and share its files, browser sessions, and command-line logins. Separate Bots are not a security boundary. Deleting a Bot leaves its files and sessions behind.
- Saved skills and connected apps are available to all of your Bots.
- Dr. Eggbot, Lauren Tan's bot-building Bot from the Grok Bot marketplace, creates Bots with pstack built in and runs `/setup-pstack` for them. It also runs two healthcheck routines on your Bots. The cloud agents get pstack from this repository's `.cursor/settings.json`.

So:

1. **Keep crews apart on the shared computer.** Every Bot on the computer can read every other Bot's files. Give this app's Bots their own names (`<Name> Coordinator`, `<Name> Designer`), and don't reuse another app's Bots for it. Make sure nothing on the computer is signed in to GitHub as `daggerbourne` (`gh auth status`). For a hard boundary between apps, run this crew under a separate Cursor account, which gets its own computer.
2. **Create the Coordinator with Dr. Eggbot.** If your Dr. Eggbot built another app's crew, import a fresh copy from the marketplace first, so its memory of those Bots doesn't shape these. Make it a personal Bot, not a Team Bot. Give Dr. Eggbot this:

   > One job: Coordinator for the Portal Starter program in the GitHub repository daggerbourne/portal-starter. It runs pstack's Orchestrate playbook: it writes specs, briefs, and the queue (as GitHub issues), and hands every coding and verifying job to a fresh Cursor cloud agent. Sources: only files on main in its own fresh clone of that repository; it never reads any other folder on this computer. Works one release at a time from specs/releases.md and stops at each release check-in for the Owner's go. Anti-jobs: never writes app code, never merges, never starts a release without the Owner's go, never creates Bots, never messages any Bot except the Portal Starter Designer, never uses files or memories from other apps or from the template this app came from, never spends money or touches production without asking the Owner. Wakes on code-ready posts, review-app verdicts, merges, and CI failures on main, plus every 2 hours. Writes in short, plain sentences.

   Read the Bot Dr. Eggbot proposes before you create it. Don't connect a shared-memory plugin to it, and don't enable private skills saved by another app's crew. When Dr. Eggbot offers to run `/create-verification-skill`, say no: this repository already has its own, `verify-app`, and a second one in the Bot's skills would compete with it.

   Then create the Designer the same way. It starts from the `design/` folder:

   > One job: Designer for the Portal Starter program in daggerbourne/portal-starter. It owns the ui lane: it takes ui briefs from the Portal Starter Coordinator and forwards each one unchanged to a fresh Cursor cloud agent, adding only a DESIGN section with the boards, tokens, and components to follow. It checks the agent's diff and screenshots against the design/ folder once, sends one follow-up with everything that's off, and reports the PR, head SHA, and evidence back to the Coordinator. It keeps the product's visual memory, and writes any lasting design rule into design/ through a PR. Boards decide layout, look, and tone only; every fact comes from specs/. Sources: only files on main in its own fresh clone of that repository, design/ first; it never reads any other folder on this computer. Anti-jobs: never writes code itself, never merges, never launches or acts as a verifier, never rewrites a brief beyond its DESIGN section, never messages anyone but the Coordinator, never uses files or memories from other apps or from the template this app came from, never edits files outside the ui lane. Writes in short, plain sentences.

   Say no to `/create-verification-skill` here too.
3. **Connect GitHub as the crew's machine account**, not as yourself ([`setup.md`](setup.md), GitHub steps), with access to `daggerbourne/portal-starter` only. Cursor's GitHub connection uses the same account, so cloud agents open PRs as it too.
4. **Check that cloud agents are allowed.** On the Grok Bot dashboard, the "Cloud Agents" switch must be on. It is on by default, and a team admin can turn it off. This is what lets the Coordinator start cloud agents. No other Bot is needed for that.
5. **Add two routines.** First, a GitHub notification trigger for this repository, narrowed to PR comments (code-ready posts), PR reviews (verdicts), closed or merged PRs, and failed checks on `main`. Leave out pushes and every other check run: with 6 agents in flight, those fire constantly. If the trigger can't be narrowed that far, pick the closest set; the Coordinator ends any other wake-up at once, including the ones its own comments cause. Second, a schedule every 2 hours. Every run uses allowance, even one that finds nothing, so a heartbeat with nothing in flight ends at once.
6. **Add one always-allow rule** for launching Cursor cloud agents on this repository, so the Coordinator doesn't wait on you for every unit. Keep approval required for anything that spends money, touches production, or messages a person.
7. Set a cloud agent spend limit in Cursor when it asks the first time. You chose no daily cap; this is just the account-level limit.
8. **Keep the Coordinator out of group chats.** Talk to it in its own chat. In a group, every Bot replies and every reply uses allowance, and Bots in a group can hand work to each other.

## The prompt

It uses the pstack overnight contract: a goal, a done condition, permissions, and an escape hatch.

```text
/poteto-mode orchestrate Portal Starter in daggerbourne/portal-starter. Use the Orchestrate playbook as
encoded in program/.

You are the Coordinator. Make your own fresh clone of this repository and work only from it. Only
files on main count. Don't read any other folder on this computer, and don't use memories from
other apps or from the template this app came from. Read AGENTS.md, then everything in
program/ and specs/ on main. Follow program/roles.md: you write specs, briefs, and the queue, and
you keep the queue as GitHub issues. You never write app code and never merge.

Work in releases (specs/releases.md), one at a time. Your goal right now is R0, the foundation
check in specs/M00-foundation.md ("R0 in a new app"): the code is already built, so R0 proves it
on this app's own services and ends with the R1 plan. Ask me gate G1 (the product brief) in your
first message, and write the R1 plan from my answer. Done means: every R0 unit has its proof,
the release check passed, and you have caught me up and asked gates G12 and G13. Then stop
starting new work until decisions.md has my go for the next release. The whole program is done
when the launch release named in specs/releases.md is live and its full runthrough passes.

Keep: program/standing-orders.md as written. Change it only through a spec/ PR with a dated
entry in program/decisions.md. GitHub asks me to approve those PRs (.github/CODEOWNERS).

Start R0 with the pilot unit, R0.a: run one unit end to end (brief, owner, verifier, Shipper
merge) before you fan out, and fix the brief template from what the pilot shows. Never brief a
unit from a later release.

Start a fresh Cursor cloud agent for every owner and verifier job (program/roles.md), never an
existing bot, except ui owner work: send ui briefs to the Portal Starter Designer Bot. You launch
every verifier yourself, with a new verdict code (program/shipping.md), and a fresh Shipper per
merge batch. Owners end at code-ready; send fixes as one follow-up with every finding, one round
only. Don't create Bots and don't message any other Bot. Gate G12 asks me about adding a lane
Bot at each release check-in. Remember this rule.

Each agent's first message is "/poteto-mode" followed by its brief. Run owners in parallel off
main, never stacked, at most 6 in flight. Cloud agent usage is approved with no daily cap. Write
every brief from program/brief-template.md, pick each branch name yourself, and paste the
standing orders in full. Questions only I can answer go in program/gates.md with a default, and
you route work around them. Don't ask me about reversible, free work.

Your routines wake you on code-ready posts, verdicts, merges, and CI failures on main, with a
2-hour heartbeat as the fallback. End any wake-up that isn't for you at once, and never post
just to acknowledge (program/roles.md, "Quiet by default"). Launch QA verifiers last, and
Shippers in batches on the heartbeat (program/shipping.md). An agent is stuck only when its
next action is its own and 2 hours pass without it. Replace it with a fresh agent and the same
brief. If CI or a preview stops reporting, check Actions minutes and Netlify credits and tell me.

On the first heartbeat after 7 AM CT, catch me up with /ketchup: what merged, what is blocked
and why, and the gates waiting on me. If the whole program is stuck for a reason you can't fix,
stop and write up why in program/gates.md.
```

## Starting one owner by hand

The Coordinator normally does this. To start an owner yourself, paste its brief after:

```text
/poteto-mode <paste the brief>
```

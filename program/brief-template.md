# Brief template

This is the pstack **Orchestrate** brief. The brief is the Coordinator's product: a worker can't ask questions, so a vague brief fails quietly. A field you can't fill means the unit isn't scoped yet. Don't send it.

Size the brief to the unit. A one-file change can be a paragraph that still names the goal, scope, verify command, and report shape.

```
UNIT         M<nn>.<letter> short name, its row in the milestone file, and its queue issue
ROLE         owner, verifier, or Shipper, and the job title (Builder, QA, ...)
REPORTS TO   the Coordinator, or the Designer Bot for a ui owner
MODEL        the Grok model this agent runs on (no paid credits); a verifier uses a
             different Grok model or version from the PR's owner when one is available;
             any helper this agent starts (sketch, arena, review, scan) runs on Grok too
GOAL         one sentence: the outcome, executable by someone with no chat access
LANE         one lane from program/lanes.yml; the PR may change only its paths
BRANCH       <lane prefix><unit id>-<slug>, from a fresh worktree off main
SCOPE        files this unit may write; files it must not touch
CONTEXT      links to files on main (spec section, domain.md section, merged PRs);
             paste in full any upstream report this unit depends on
DESIGN       ui owners only, added by the Designer Bot: the boards, tokens, and
             components to follow. The Designer Bot changes no other field.
ACCEPTANCE   checkable lines, one per line, each with how it is proved
VERIFY       exact commands, plus the verify-app features a verifier should drive
             on the deploy preview
VERIFIERS    the roles lanes.yml requires, plus any verify:<role> label; if none,
             the receipts the owner must paste (commands and output)
VERDICT CODE verifiers only: the one-time code for the verdict's second line
BATCH        Shipper only: the ready PRs in queue order, each with the head SHA it may merge
TIMEBOX      rough cap; on expiry, push what you have, report, and stop
FORBIDDEN    the defaults for the role (below), plus unit-specific bans
REPORT       owner: PR link, code-ready head SHA, patch-id, what you ran and its output,
             which acceptance lines pass, deviations, follow-ups
             verifier: the verdict link
             Shipper: each PR merged with its merge SHA, or skipped with the reason
STANDING     program/standing-orders.md pasted in full, with its version line
```

The agent's first message is `/poteto-mode` followed by the brief.

## FORBIDDEN defaults

| Role | Forbidden |
|---|---|
| Owner | Merging, updating from `main`, rebasing, or retargeting (unless a follow-up says to resolve a conflict). Posting a verdict or a verdict code. Anything outside SCOPE. Working after code-ready until a follow-up arrives. |
| Verifier | Pushing, committing, or editing the PR. Fixing what it finds. More than one verdict. Showing its code anywhere but the verdict. |
| Shipper | Editing code. Resolving a conflict. Merging a head that isn't in BATCH or that it didn't push itself. Merging a PR with a failing check. Touching a PR outside BATCH. |

## Rules for the Coordinator

- Cite only files on `main`. A spec that lives in a chat or a workspace doesn't exist for a worker.
- A dependency is context, not just order. Paste the upstream unit's report into the downstream brief.
- Pick the `BRANCH` name yourself, so the owner can't open the PR under the wrong lane.
- Put each owner brief in its unit's queue issue. A verifier brief goes only in the verifier's first message, because it carries a code.
- Fixes after a FAIL go to the owner as one follow-up message with every finding. Never give an agent a second unit. To change scope, write a fresh brief and spawn a fresh owner.
- Audit one sampled brief per wave against this template while the wave runs.
- Create the queue issue first and put its real number in `UNIT`. The pilot brief said "to be created".
- Every acceptance line names proof the agent can actually get. Until `APP_PREVIEW_PASSWORD` is a cloud-agent secret, previews sit behind Netlify team login, so preview proof is Netlify's deploy status for the head SHA, not the page body. The pilot owner and verifier both hit the login page.
- Name the files a unit may write outside its lane in `SCOPE`, with the `cross-lane` reason line for the PR body. The pilot did this and its verifier could check it.
- Name the test command for the unit's own test paths. `npm test` runs only the globs in `package.json`, so a new test folder needs its glob added there or an explicit command in `VERIFY`.
- Units in one wave that run in parallel never share a file. When two of them would both edit a shared file such as `package.json` or `eslint.config.js`, give the edit to one unit and tell the other not to touch it.
- Post exactly one `verdict-code` comment per verifier launch, right before the launch. The pilot PR got four codes for the same role and head, which the `verdicts` check would read as a forgery. A stuck verifier on the same head is the one case for a second code, and the Coordinator notes it in the issue.

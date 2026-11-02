# Shipping: from code-ready to merged

This follows the pstack **Shipping** and **Autopilot-full** playbooks. It exists to stop the loop where every merge forces every other PR to update and re-sign.

## Why it works this way

When verdicts are approvals tied to an exact SHA and branches must be up to date before merging, each merge puts every other open PR behind `main`. The update makes a new SHA, so every verifier signs the same diff again. With 20 PRs open, that work grows with the square of the queue.

Here, a verdict is a comment review tied to the part of the diff it checked. An update from `main`, or a fix somewhere else in the PR, leaves it standing.

## Rules on `main`

A GitHub ruleset named `main`, set up by the Owner ([`setup.md`](setup.md)):

- A pull request is required. Required approvals: **0**. "Require review from Code Owners": **on**, so a PR that changes a file in [`.github/CODEOWNERS`](../.github/CODEOWNERS) needs the Owner's approval.
- "Dismiss stale approvals when new commits are pushed": **on**. It only touches approvals, and the only approvals are the Owner's. With it on, their approval covers only what they saw. Verdicts are comment reviews, so it never touches them.
- Required checks: `ci`, `scope`, `verdicts`, added once each has run on a PR ([`setup.md`](setup.md), step 8).
- "Require branches to be up to date before merging": **off**. The Shipper decides when an update is needed (step 4).
- Squash merges only. No GitHub auto-merge: the Shipper merges by hand, so a merge never lands an unverified head.
- Force pushes and branch deletion blocked on `main`. The bypass list is empty.

## Flow

1. **Code-ready.** The owner agent pushes, watches CI on that head, and fixes its own failures. When CI is green and the deploy preview for that head is live (with its own database copy when the PR changes `db/` or `server/`), it posts in the PR `code-ready at <sha>`, reports to whoever launched it (the Coordinator, or the Designer Bot for ui), and ends. It doesn't update from `main` first.
2. **Verify.** If [`lanes.yml`](lanes.yml) requires no role and the PR has no `verify:<role>` label, the Coordinator checks the owner's receipts and moves on to step 3. Otherwise the Coordinator launches a fresh verifier agent for each required role, each with a new verdict code (below). Each one runs the change on the deploy preview and posts one verdict naming the head SHA.
   - **QA goes last.** The Coordinator launches CTO and Designer verifiers first, and QA once they pass. QA is the most expensive check, and a fix after a CTO or design finding would make it run twice.
   - A FAIL goes back to the owner as one follow-up message with every finding. The owner fixes them on the same branch in one push and reports the new head.
   - **Only the roles the fix touched re-verify.** A PASS stands while the part of the diff that made its role required is unchanged ([the `verdicts` check](#the-verdicts-check)). The roles whose part changed get one fresh verifier each.
   - A finding still open after that pass, or one the owner disputes, goes to the Coordinator. It decides or writes a gate. There is no third round.
   - A verifier that finds no preview, or a preview that isn't on the PR's head, reports "blocked: preview" to the Coordinator instead of failing the PR.
3. **Queue.** A PR is ready when every required verdict stands. The Coordinator labels its issue `ready`. The lowest issue number goes first. If GitHub also needs the Owner's approval (a code-owner file), the Coordinator asks the Owner once, now, in its chat, with the PR link.
4. **Batch.** The Coordinator launches a Shipper on the next heartbeat with every ready PR, or sooner when a ready PR blocks the next unit in the queue. It never launches one Shipper per PR. The batch lists the PRs in order, each with its head SHA. Code-owner PRs go first, so `main` hasn't moved under the Owner's approval. For each PR, the Shipper fetches `main` and asks one question: can what changed on `main` since this PR's base affect this patch?
   - **No** (different files, no shared callers or dependencies): merge as is.
   - **Yes, but no conflict**: update the branch, wait for green CI, and confirm the verdicts still stand. Merge. On a code-owner PR the update dismisses the Owner's approval, so the Shipper skips it and reports it, and the Coordinator asks the Owner to approve the updated PR.
   - **Conflict**: skip it and report it. The Coordinator sends the owner a follow-up to resolve it on its branch, and the roles whose part changed re-verify.
   - A PR that would need a third update in a row waits, and the Coordinator reorders the queue around it.
5. **Merge.** Squash-merge one PR at a time, passing the expected head SHA to the merge, so a head nobody verified can't merge. Read the PR back to confirm it shows as merged into `main`.
6. **After the merge.** Don't touch other PRs. They update only when they reach step 4 themselves. When the batch merged anything, the Shipper fast-forwards `auth-test` to `main`'s new head (`git push origin <main sha>:refs/heads/auth-test`), so the sign-in host runs what `main` runs. The Shipper reports each PR as merged, with its merge SHA, or as skipped, with the reason, and ends when the batch is done.

## The `verdicts` check

It reads [`lanes.yml`](lanes.yml) and the PR's `verify:<role>` labels for the required roles, then reads reviews from the `crew-review` app. A verdict counts when:

- its role is required, and it is PASS or PASS+NOTES;
- its code matches a fingerprint for that role and head ([verdict codes](#verdict-codes));
- the PR's diff, limited to the paths that made the role required (`qa_paths` for QA, `risk_paths` for CTO, `design_paths` for Designer), has the same patch-id (`git patch-id --stable`) at the current head as at the head the verdict names. A role added only by a `verify:<role>` label uses the whole diff.

So an update from `main` keeps every verdict, and a fix to `server/` keeps a CTO verdict that only covered `db/`.

It reruns on pushes, on reviews from the review app, and on comments that start with `verdict-code`. Every other comment or review skips the job with an `if:` condition, which uses no Actions minutes. The check is built in M00.d ([`specs/M00-foundation.md`](../specs/M00-foundation.md)).

## Verdict codes

The review app's key is a cloud-agent secret, so any agent, an owner included, could post a verdict through it. A verdict code makes a self-posted verdict fail.

1. When it launches a verifier, the Coordinator makes a random one-time code, puts it in that verifier's brief only, and posts a PR comment: `verdict-code <role> <head sha> <sha256 of the code>`.
2. The verifier writes the code on the second line of its verdict: `code <code>`.
3. The `verdicts` check hashes the code and matches it to the fingerprint for that role and head. Each code counts once.
4. Two fingerprints for the same role and head fail the check, so a forged one shows up instead of passing. The Coordinator looks into it before anything merges.

Verifier briefs go only in the verifier's first message, never in an issue, a PR, or a file.

## End of a release

When a release's last unit merges, the release check and check-in in [`specs/releases.md`](../specs/releases.md) run before any unit of the next release starts.

## CI failures

pstack **Babysit** step 7 applies to the owner watching its own CI. Read the failure before anything else. A flake gets one fresh run. The same failure twice is not a flake. A failure in code the PR didn't touch means a stale base, so report it to the Coordinator instead of retrying.

CI or a preview that hasn't reported for 2 hours is not a stuck agent. It usually means GitHub Actions minutes or Netlify credits ran out. The Coordinator checks that and tells the Owner; it doesn't replace agents over it.

# Releases

The milestone files say **what** to build. This file says **when**. Releases only set the order, so each one ends with something the Owner can use.

The Coordinator works on **one release at a time**. It doesn't brief units from a later release, even when they look independent.

## The plan

| Release | Units | What works at the end |
|---|---|---|
| **R0 Foundation check** | The M00 proof units ([M00](M00-foundation.md#r0-in-a-new-app)) | The template's foundation runs on this app's own GitHub, Netlify, Neon, and Entra setup: CI and the required checks, previews with database copies, staff sign-in on `auth-test`, and a `verify-app` pass. The Coordinator has drafted the R1 plan from gate G1. |
| **R1 and later** | Written by the Coordinator at the R0 check-in, from the Owner's product brief (gate G1) | One row per release. Mark the **launch release**: the one after which `main` is production (standing order 39). |

## How a release runs

1. **Start.** The release starts only when [`program/decisions.md`](../program/decisions.md) has an entry from the Owner starting it. R0 starts with the kickoff.
2. **Build.** The Coordinator briefs the release's units in dependency order, at most 6 owners in flight.
3. **Done.** Every unit in the release is merged, each with the verdicts it needs.
4. **Release check.** A QA verifier agent runs every feature of the release with `verify-app`, as one pass, on `main`'s branch deploy (production after launch). Anything it finds becomes a fix unit in the same release.
5. **Check-in.** The Coordinator stops starting new work and catches the Owner up: what works now, preview links to try it, what the QA pass found, open gates, and two questions: start the next release (gate G13), and add a lane Bot (gate G12). It waits for the answer.

## Rules across releases

- **Build only on what's merged.** A unit never builds against a feature from a later release. When a spec mentions a later feature, leave the hook out. The later release has a unit that adds it.
- **After launch, `main` is production.** From the launch release on, every merge deploys to real users, so standing order 39 applies.
- **Keep releases small.** If a release grows past about 25 units, the Coordinator proposes a split at the check-in rather than pushing through.

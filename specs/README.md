# Portal Starter specs

The milestones say **what** to build. [`releases.md`](releases.md) says **when**: releases built one at a time, each ending in something usable.

Read [`domain.md`](domain.md) first. It defines the names, roles, and states every milestone uses.

## Milestones

| # | Milestone | What a user or staff member can do when it's done | Release |
|---|---|---|---|
| [M00](M00-foundation.md) | Foundation | Staff sign in to an admin that lists users. Users have a portal behind a pluggable sign-in. CI enforces lanes, size, and verdicts. | R0 |

The Coordinator adds a row per milestone once the Owner's product brief (gate G1) is in `program/decisions.md`. Number them M01, M02, and so on, one file each, named `M<nn>-<slug>.md`.

## How a milestone file is laid out

Goal, user stories, rules, data, integrations, units, done when, and open gates. The **Units** list is the Coordinator's starting cut. Each unit becomes one brief and one PR of 400 lines or less. **Done when** lines are what QA checks on the deployed preview.

A `ui` unit ships pure renders, with no routes ([`lanes.yml`](../program/lanes.yml)), and ships a `.gallery.ts` file with sample data beside each one, so its preview shows them in the render gallery. When no core unit in the milestone mounts its screens, the Coordinator queues one right after it, named after the ui unit with `-mount` (for example `M01.c-mount`), so no page needs one PR in two lanes.

User-facing work follows the portal pattern from M00: user routes live under `/portal-starter/portal`, read through `handleUserSession`, and scope every query to the signed-in user (standing order 6). Staff routes live under `/portal-starter/admin` and go through the admin guard.

## Words used in specs

- **Visual values** (colors, sizes, spacing, focus, motion) live only in [`design/tokens.md`](../design/tokens.md). Specs link there and never restate a value, so they can't drift.
- **PLACEHOLDER**: wording or a number waiting on the Owner. Ship it labeled, and list it in [`program/gates.md`](../program/gates.md).
- **Mock, sandbox, live**: the adapter modes from standing order 8.

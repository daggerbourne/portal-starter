# Design

The app's visual design system. The Designer Bot owns this folder. Its cloud agents read it before every ui unit.

It starts as a dark, accessible theme that passes WCAG 2.2 AA. Restyle an app by changing `tokens.css` and `tokens.md` together, and add a ratio to `ratios.md` for every new color pair first.

## Source of truth

| File | What it is |
|---|---|
| [`tokens.md`](tokens.md) and [`tokens.css`](tokens.css) | Colors, type, spacing, radius, focus, motion. The app loads `tokens.css` as is; ui code never copies a token value. |
| [`components.md`](components.md) | Buttons, fields, choice tiles, tables, and the empty, loading, error, success, and disabled states. |
| [`ui-review-checklist.md`](ui-review-checklist.md) | Paste into every ui PR. The Designer verifier checks against it. |
| [`motion.md`](motion.md) | Screen motion. |
| [`ratios.md`](ratios.md) and [`contrast.py`](contrast.py) | Contrast ratios for every color pair, and the script that computes them. A new color needs a ratio here first. |

Rules that matter most: one primary button per screen, body text 17px (nothing under 14px), input edges `--border-strong`, dark text on cyan buttons, a visible focus ring everywhere, 44px tap targets, and layouts checked at 390 and 1280 (320 for reflow).

## Boards

The template ships no storyboards. When an app's product brief arrives, the Designer adds boards under `design/storyboards/` (one per screen, with phone and desktop renders) and a "Boards by unit" table here, so each ui unit can name the boards it follows.

A board decides layout, look, and tone: how a screen is arranged, how it looks, and how its words sound. Nothing else. Every number, status, rule, and setting on a board is sample data. Facts come from [`specs/`](../specs/) and app settings. Where a board and a spec disagree on anything but layout, look, or tone, the spec wins.

Names, addresses, and domains on boards are made up (`example.test`, reserved domains). Keep it that way.

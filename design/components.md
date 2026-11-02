# Components
Use `tokens.css`. Every interactive element: ≥44×44px target, visible `:focus-visible` ring (#67e8f9, 2px, offset 2px), no state shown by color alone (add icon or text). Site class names kept (`btn--primary`, `form-group`, `service-card`).

## Shared states (every component that loads data)
| State | Pattern |
|---|---|
| Empty | Icon + one plain sentence + one action ("No requests yet. Start a request"). `--text-secondary`. |
| Loading | Skeleton blocks on `--bg-elevated` (no shimmer under reduced motion) or one progress bar; `aria-busy="true"`; text "Loading…" for SR. Over 10 s: say what is happening. |
| Error | `--error-bg` box, 1px `--error-border`, ⚠ icon + `--error` text, what happened + what to do + retry button; `role="alert"`. Never raw error codes except a short Ref id. |
| Success | `--success-bg`, 1px `--success-border`, ✓ icon + `--success` text; `role="status"`. |
| Disabled | `--bg-disabled` fill, `--text-muted` text (5.71:1), `--border-strong` edge, `cursor:not-allowed`, `aria-disabled`. **No opacity fades** (site's 50% = 2.25:1). Explain why next to it if the user must act ("Tick the terms box to pay"). |

## Buttons
- Height 48px, padding 0 20px, radius 12px, 16px/600 text, icon gap 8px.
- `btn--primary`: `--accent-gradient` (#22d3ee→#38bdf8) or `--primary`, text `--on-primary` #080c10 (≥9.16:1). Hover `--primary-hover`, translateY(-1px). **One per screen.**
- `btn--outline`: transparent, 1px `--border-strong`, text `--text-primary`; hover border `--border-hover`.
- `btn--ghost` (tertiary, links-as-buttons): `--link` text, underline on hover; still 44px tall.
- `btn--danger`: `--error` fill #fca5a5, text #080c10 (10.34:1), confirm step required.
- Loading: keep width, spinner + "Sending…", `aria-busy`. Full width on mobile < 768px.

## Inputs
- 48px tall, `--bg-elevated`, 1px `--border-strong` (3.56:1), radius 12px, 16px text (prevents iOS zoom), placeholder `--text-muted` and never used as the label.
- Label above, 16px/500 `--text-primary`; hint below 16px `--text-secondary`, linked via `aria-describedby`.
- Focus: border `--focus-ring` + `--focus`. Error: border 2px `--error-border`, ⚠ + message under field, `aria-invalid="true"`. Success (verified): ✓ + text.
- Checkbox/radio: 24px box inside a 44px row, whole row clickable. Choice tiles: ≥64px, `--border-strong`, selected = 2px `--primary` border + ✓ (not color alone).

## Cards
`--bg-card`, 1px `--border` OK (decorative) because the card isn't a control; padding 24px (20px mobile); radius 12px; title h3 `--text-primary`, body `--text-secondary`. Clickable card: whole card is one link, border `--border-strong`, focus ring on the card.

## Stepper (photo walkthrough, intake)
- Top: "Step 3 of 8 · Modem / ISP box" in 16px (mono allowed for "3 of 8"), progress bar 6px tall on `--bg-elevated` with `--primary` fill and a text equivalent.
- Steps are `<ol>`; current `aria-current="step"`; done = ✓ + "Done"; skipped = "Skipped" text (skippable steps show a **Skip this step** ghost button, never the primary).
- Back is an outline button left, primary right ("Next"). Mobile: sticky bottom bar 72px with safe-area padding.

## Photo tiles
- Aspect 4:3, radius 8px, 1px `--border-strong`. Thumbnail via `<img alt>` describing the kind ("Modem photo").
- **Any text over a photo sits on `--scrim`** (bottom gradient, 72–88% #080c10). Worst case white photo: 7.41:1. No text on a bare photo, ever.
- Empty tile: dashed 2px `--border-strong`, camera icon, "Add photo" 16px, whole tile is a ≥44px button. Uploading: progress bar + "Uploading 60%". Error: red ⚠ badge + "Upload failed. Try again" button. Remove: 44px × button top-right on a scrim chip, with label "Remove modem photo".

## Tables (admin lists)
- Row height ≥48px, cell text 16px `--text-primary`, header 14px/600 uppercase-optional `--text-secondary`, row divider `--border`, zebra `--bg-surface`. Numbers right-aligned, tabular-nums.
- Mobile < 768px: rows become stacked cards (label: value), not horizontal scroll, unless the table is admin-only (then sticky first column + scroll with visible shadow cue).
- Status in table = pill with icon + word ("● In review"), not color only. Empty/loading/error per shared states.

## Toasts
- Bottom-center mobile (above sticky bar), bottom-right desktop; max width 28rem; `--bg-card` with 4px left border in status color + icon + text 16px.
- `role="status"` (success/info) or `role="alert"` (error). Stay ≥6 s, pause on hover/focus, close button 44px. Never the only place an error appears (also show inline).

# UI review checklist (every UI PR)

Paste into the PR description, tick each box, attach evidence. A box that doesn't apply: write "n/a – why".
Sources (only these): WCAG 2.2 Recommendation https://www.w3.org/TR/WCAG22/ and the W3C "Understanding WCAG 2.2" pages https://www.w3.org/WAI/WCAG22/Understanding/ . Contrast math: `design/contrast.py` (WCAG relative-luminance definition).

## Evidence (required)
- [ ] Screenshot **mobile 390×844** and **desktop 1280×800** of every changed screen, from the PR's deploy preview, each state touched (empty, loading, error, success, disabled).
- [ ] Screenshot of keyboard focus on the primary action at both widths.
- [ ] `python3 design/contrast.py` output or a ratio for every new color pair.

## Visual / tokens
- [ ] Only `tokens.css` variables; no new hex values without a ratio in tokens.md.
- [ ] One primary button per screen; plain-word labels (verb + object).
- [ ] Body ≥16px (17px default), line-height ≥1.5; nothing under 14px.
- [ ] No light-gray-on-white, no `opacity` used to fade text or disabled controls.
- [ ] Text over photos uses `--scrim`.

## WCAG 2.2 (Level AA unless noted)
- [ ] **1.1.1 Non-text Content (A)**: images/photo tiles have meaningful `alt`; decorative icons `aria-hidden`.
- [ ] **1.3.1 Info and Relationships (A)**: real headings, `<label for>`, `<ol>` steppers, `<th scope>` tables.
- [ ] **1.4.1 Use of Color (A)**: status/selection/errors also shown by icon or text.
- [ ] **1.4.3 Contrast (Minimum)**: text ≥4.5:1 (≥3:1 only for ≥24px or ≥18.66px bold).
- [ ] **1.4.4 Resize Text**: usable at 200% zoom.
- [ ] **1.4.10 Reflow**: no horizontal scroll at 320 CSS px (390 screenshot shows no clipping; admin data tables excepted per SC).
- [ ] **1.4.11 Non-text Contrast**: input borders, checkboxes, focus rings, icons that carry meaning ≥3:1 vs adjacent color.
- [ ] **1.4.12 Text Spacing**: no clipping with increased line/letter/word spacing.
- [ ] **2.1.1 Keyboard (A)**: every action works by keyboard; no traps (2.1.2).
- [ ] **2.4.3 Focus Order (A)**: logical; dialogs move and return focus.
- [ ] **2.4.7 Focus Visible**: `:focus-visible` ring present on every interactive element.
- [ ] **2.4.11 Focus Not Obscured (Minimum)**: focused item not fully hidden by sticky nav, DEV banner, sticky bottom bar or toasts (use `scroll-padding`).
- [ ] **2.5.8 Target Size (Minimum)**: SC floor 24×24 CSS px; **our rule is ≥44×44**.
- [ ] **3.3.1 Error Identification (A)** / **3.3.2 Labels or Instructions (A)**: errors in text next to the field; every field labelled.
- [ ] **3.3.7 Redundant Entry (A)**: don't re-ask info entered earlier in the flow (address, email).
- [ ] **3.3.8 Accessible Authentication (Minimum)**: magic link / Microsoft sign-in; no puzzles; paste allowed.
- [ ] **4.1.2 Name, Role, Value (A)**: custom controls expose role/state (`aria-current`, `aria-pressed`, `aria-invalid`).
- [ ] **4.1.3 Status Messages**: toasts/upload progress/"Saved" use `role="status"`/`alert`.
- [ ] Motion: honors `prefers-reduced-motion` (team rule; see also 2.3.3 Animation from Interactions, Level AAA).

## Sign-off
Reviewer: ___ Date (CT): ___ Result: pass / changes needed

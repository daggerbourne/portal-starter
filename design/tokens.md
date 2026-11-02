# Tokens

This file and `tokens.css` are the source of truth for color, type, spacing, radius, focus, and motion. A new value needs a contrast ratio here first.

The starting theme: dark-only surfaces, Inter 400–700, 12px radius, cyan→blue accent, 72rem container, 4.5rem nav, 0.25–5rem spacing steps, BEM class names.
Changed only to pass WCAG 2.2 AA (marked **AA fix**). CSS: `tokens.css`. Ratios: `python3 contrast.py` (WCAG relative-luminance formula; output saved in `ratios.md`).

## Color: text pairs (ratio, AA body text needs 4.5:1)
| Text token | bg-deep #080c10 | surface #0f1419 | elevated #161d27 | card #1a2332 |
|---|---|---|---|---|
| `--text-primary` #f1f5f9 | 17.91 | 16.90 | 15.47 | 14.41 |
| `--text-secondary` #cbd5e1 (**new**, body copy) | 13.21 | 12.47 | 11.41 | 10.63 |
| `--text-muted` #94a3b8 (metadata only) | 7.65 | 7.22 | 6.61 | 6.16 |
| `--link` #22d3ee (**AA fix**, was #00c4d1 9.17 on deep) | 10.86 | 10.24 | 9.38 | 8.73 |
| `--error` #fca5a5 | 10.34 | 9.75 | 8.93 | 8.32 |
| `--success` #6ee7b7 | 12.87 | 12.14 | 11.12 | 10.36 |
| `--warning` #fcd34d | 13.61 | 12.84 | 11.75 | 10.95 |

| Pair | Ratio |
|---|---|
| `--on-primary` #080c10 on `--primary` #22d3ee (**AA fix**: site uses #fff on #00c4d1 = **2.14**) | 10.86 |
| #080c10 on gradient end #38bdf8 | 9.16 |
| #080c10 on `--primary-hover` #67e8f9 | 13.53 |
| `--error` on `--error-bg` #3a1d24 | 8.01 |
| `--success` on `--success-bg` #0f2e2a | 9.54 |
| `--warning` on `--warning-bg` #33290f | 9.94 |
| disabled text #94a3b8 on `--bg-disabled` #1e293b | 5.71 |
| dev banner #080c10 on #fbbf24 | 11.75 |
| `--text-primary` on `--scrim-solid` over a pure-white photo | 7.41 |
| `--text-secondary` on scrim over pure-white photo | 5.47 |

## Color: non-text (WCAG 1.4.11 needs 3:1 vs adjacent)
| Token | deep | surface | elevated | card |
|---|---|---|---|---|
| `--border-strong` #64748b (**AA fix** for input/control edges; was 8% white = 1.27–1.46) | 4.12 | 3.89 | 3.56 | 3.32 |
| `--focus-ring` #67e8f9 | 13.53 | 12.77 | 11.69 | 10.89 |
`--border` (8% white) stays for decorative dividers only; it may never be the only edge of a control.

Rules: no text lighter than slate-400 on light surfaces (there are no light surfaces); `--accent-blue` #3b8fd9 is never text; disabled = token colors, not `opacity`.

## Type (Inter; mono for step labels/IDs)
| Role | Size | Weight | Line-height |
|---|---|---|---|
| h1 | clamp(2rem,5vw,3.25rem) | 700, −0.02em | 1.15 |
| h2 | clamp(1.75rem,3vw,2.25rem) | 700, −0.02em | 1.2 |
| h3 | 1.5rem | 600 | 1.3 |
| Lead | 1.25rem | 400 | 1.6 |
| **Body** | **1.0625rem (17px)** | 400 | **1.6** |
| Label / hint / table cell / button | 1rem (16px) (**AA fix**: was 0.85rem/0.875rem) | 500–600 | 1.5 |
| Badge / legal | 0.875rem (14px) floor, weight ≥500 (was 0.75rem mono) | 500 | 1.5 |

## Spacing, layout
4px grid: `--space-1..20` = 4, 8, 12, 16, 20, 24, 32, 48, 80 px. Container `min(72rem,100% - 2rem)`. Nav 4.5rem. Breakpoint 768px. Controls 48px tall; every tap target ≥44×44px (`--tap`).

## Radius, focus, motion
Radius 12px (controls, cards), 8px (icon tiles, thumbnails), pill for chips. Focus: 2px solid #67e8f9 outline, 2px offset (or `--focus` double ring on inputs); never removed, never only a glow (site's 30% cyan glow = 1.78:1). Motion: 150/250/400ms, ease-out, opacity/transform only, zero under `prefers-reduced-motion`.

# Motion

Canonical tokens are not re-derived here. Sources:
- `design/tokens.css`: `--ease-out cubic-bezier(0.16,1,0.3,1)`, `--ease-in cubic-bezier(0.7,0,0.84,0)`, `--dur-fast 150ms`, `--dur-step 250ms`, `--dur-reveal 400ms`. Loading bar track `--border`, fill `--accent-gradient`.
- Rules: every UI motion 400ms or less, opacity and transform only, no bounce or overshoot, one infinite animation at most (the loading bar), and `prefers-reduced-motion` honored.

### Per screen
- Step change: exit 200ms `--ease-in` to translateX(-12px); enter 250ms `--ease-out` from translateX(12px). Back reverses.
- Progress bar: 300ms `--ease-out` (scaleX). Focus ring and tile select: 150ms.
- Result reveal: card 250ms; an optional single 400ms emphasis.
- Indeterminate loading bar: under a 1.2s cycle, the app's only infinite animation; stops when loading ends.
- Reduced motion (`prefers-reduced-motion: reduce`): crossfades of 150ms or less only; no slide, scan, or count-up.
- Hard caps: every UI motion ≤ 400ms; CSS or Framer only; no Lottie, GIF or MP4 in the app; no parallax, confetti or animated glow.

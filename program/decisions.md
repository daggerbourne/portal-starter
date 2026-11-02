# Decisions

The Owner's product and process decisions, newest first. Append only. Each entry says what changed and which spec or standing order carries it. A decision relayed in chat counts only once it is here.

Times are CT.

## Template baseline

These came with the Portal Starter template. They hold until a dated entry above replaces one.

- **Stack.** GitHub (repository, queue as issues, CI on Actions), Netlify (site under `/portal-starter`, functions in `server/functions/`, a preview per PR), and Neon Postgres (`production`, `dev`, and a short-lived copy of `dev` per PR that changes `db/` or `server/`). Node 22, TypeScript strict, `node:test` through `tsx`. ([M00](../specs/M00-foundation.md))
- **Two portals.** Staff and the Owner use `/portal-starter/admin` and sign in with Microsoft Entra. Users use `/portal-starter/portal` with a separate session, cookie, and key. The user sign-in provider is a stub until gate G2 is answered. (Standing orders 11 to 13, [M00](../specs/M00-foundation.md).)
- **Open first sign-in.** A first sign-in through the user provider creates an active user; a user staff invited first becomes active at first sign-in. Gate G3 can change this. ([`specs/domain.md`](../specs/domain.md))
- **Build in releases.** One release at a time, each ending in something usable, a QA pass, and a check-in. The next release starts only on the Owner's go (gate G13). ([`specs/releases.md`](../specs/releases.md))
- **Free tiers until launch.** `main` deploys as a free Netlify branch deploy until the launch release switches production to `main`, because each production deploy costs Netlify credits and running out pauses every site on the team. Neon stays on the free plan (10 branches: `production`, `dev`, and 8 PR copies). Anything that costs money is gate G9.
- **Crew.** Two Grok Bots, the Coordinator and the Designer, built by Dr. Eggbot. Every owner, verifier, and Shipper is a fresh Cursor cloud agent running pstack, at most 6 owners in flight, no daily cap. Cloud agents and any helpers they start run on Grok models; a verifier uses a different model or version from its owner when one is available. ([`roles.md`](roles.md))
- **Verification scales to risk.** QA for `server/` and `db/`, CTO for risk paths, Designer for the ui lane, plus any role the Coordinator adds with a label. Verdicts carry one-time codes. ([`lanes.yml`](lanes.yml), [`shipping.md`](shipping.md))
- **Dev autonomy.** While the app is in dev, the crew acts on its own judgment for reversible, free changes: code, config, Netlify env vars, and dev data on the Neon `dev` branch. Anything that costs money, live keys, and Neon production need the Owner. (Standing order 28.)
- **No comments, no debug code, behavior tests.** Following pstack. `cursor-team-kit` is enabled for `/deslop`. (Standing orders 36 to 38.)
- **Plugin settings ship without the Owner.** `.cursor/settings.json` is not in [`.github/CODEOWNERS`](../.github/CODEOWNERS); CI, the rule files, and decisions are.

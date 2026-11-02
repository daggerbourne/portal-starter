# Gates

Questions only the Owner can answer. Each gate has options and a default, so work can route around it while it waits. When the Owner answers, the Coordinator moves the answer to [`decisions.md`](decisions.md), updates the spec, and deletes the gate here.

What always needs a gate: spending money, live keys, real user data, production, go-live, and product calls no test can settle. Everything else is the crew's call (standing order 28).

## Open

| # | Question | Options | Default if no answer | Blocks |
|---|---|---|---|---|
| G1 | The product brief: who the users are, what they do in the portal, what staff do in admin, and what "launched" means. The Coordinator turns the answer into `specs/domain.md`, milestone files, and `specs/releases.md`. | write it / talk it through at the R0 check-in | none | R1 |
| G2 | User sign-in provider for the portal: email magic link (through an email adapter), Microsoft Entra External ID, Google, another OIDC provider, or Neon Auth. | pick one | stub (`501`) | the first release with users |
| G3 | First-sign-in policy: anyone who signs in becomes an active user, or only users staff invited first. | open / invite only | open (the template's behaviour) | the first release with users |
| G9 | Paid setup, asked per release: a Neon plan with protected branches (the free plan has none), a Netlify plan, an email or SMS provider, and anything else that costs money. | approve per item | free tier only | the launch release |
| G10 | Go-live: point the public domain or path at the app, turn preview protection back on, and switch Netlify production to `main`. | yes / hold | hold | the launch release |
| G12 | Add another lane Bot? Candidates: Builder (core and onboarding), Integrations (adapters), QA (verification), CTO (config, risk review, shipping). Asked at every release check-in. The Coordinator brings evidence: where it was the bottleneck, and what a lane Bot would have remembered. | add one (name it) / not yet | not yet | nothing |
| G13 | Start the next release? Asked at every release check-in, after the Owner has tried the finished release on the preview (or in production after launch). | start / change the plan first / hold | hold | the next release |

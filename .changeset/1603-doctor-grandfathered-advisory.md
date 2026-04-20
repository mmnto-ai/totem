---
'@mmnto/cli': patch
---

Add `totem doctor` Grandfathered Rules advisory (mmnto-ai/totem#1603, part 2 of #1581).

Surfaces the pre-zero-trust cohort (active rules without the ADR-089 `unverified` flag) categorized by reason code:

- `vintage-pre-1.13.0` — rule compiled before the 1.13.0 ship date
- `no-badExample` — absent or empty `badExample` substrate field
- `no-goodExample` — absent or empty `goodExample` substrate field

On the current corpus the advisory reports 378 grandfathered rules (358 vintage-pre-1.13.0, 371 no-badExample, 378 no-goodExample). This is the mechanically true state; categorization gives users a triage-able surface.

Advisory-only (`status: 'warn'`). ADR-091 Stage 4 Codebase Verifier (1.16.0, mmnto-ai/totem#1504) is the empirical audit path — that verifier runs rules against actual code and does not depend on the substrate snippet fields the legacy cohort lacks. The `doctor` advisory holds the position until Stage 4 ships.

Final item of the 1.15.0 compile-hardening ship gate.

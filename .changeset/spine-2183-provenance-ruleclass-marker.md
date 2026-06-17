---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

feat(spine): explicit provenance/ruleClass marker on compiled rules — retire the #2181 engine-type advisory proxy (#2183)

Adds the durable Gate-1 legitimacy marker that replaces the interim #2181 engine-type proxy with a first-class enforcement attribute, per ADR-110 §2/§3 and Proposal 299 Amendment 1.

- **Core (`@mmnto/totem`):** new optional `legitimacy` record on `CompiledRule` — three peer legs mapping 1:1 onto the ADR-110 §3 bar (`provenance` / `positiveControl` / `negativeControl`), with a mechanically-validated `ProvenanceRecord` (`mergedPr`, `reviewThread`, `commitSha`) — plus an optional derived `ruleClass`. A pure `deriveRuleClass()` helper encodes the 3-part bar (hard iff legitimacy present, the rule is promoted via the existing ADR-089 `unverified` flag, and both controls pass). A schema invariant on `CompiledRuleSchema` requires `legitimacy` and `ruleClass` to be present-together-or-absent-together and consistent, so a forged or inconsistent stamp fails to parse at the runtime-load boundary.
- **CLI (`@mmnto/cli`):** `totem lint` now derives the hard tier from `ruleClass` when present and falls back to the engine-type proxy only for un-stamped legacy rules. The severity gate is unchanged (blocking = hard tier AND error-severity), and the frozen-lesson advisory label is scoped to legacy rules so a minted advisory rule is never mislabeled.

Additive and backward-compatible: existing rules carry neither field, fall through to the legacy proxy with identical behavior, and serialize byte-identically (no compile-manifest churn). The `deriveRuleClass` helper is intentionally **unwired** from the frozen compile pipeline — spine rule-regeneration (strategy#516) is the sanctioned writer.

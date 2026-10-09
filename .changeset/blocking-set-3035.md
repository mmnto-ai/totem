---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

**One blocking predicate, shared by `totem lint` and the new `totem rule list --blocking`.** This is mmnto-ai/totem#3035.

- **API (`@mmnto/totem`).** New pure exports `ruleTier(rule)` (`'hard' | 'advisory'`: the `ruleClass` stamp when present, else `ast` / `ast-grep` are hard and `regex` is advisory), `isBlockingRule(rule)` (hard tier AND an effective severity of `error`) and `effectiveSeverity(rule)` (the stored severity, or `error` when absent), with the types `RuleTier` and `RuleTierInput`. The linter's blocking classification now calls `isBlockingRule`; which rules block is unchanged.
- **`totem rule list --blocking` (`@mmnto/cli`).** Lists only the active rules that block lint. An archived rule is never listed. When none block, the command succeeds with an empty list and a line saying 0 of N active rules block; in JSON mode it returns `status: success` with `rules: []`.
- **`totem rule list --json` rows** gain `tier` and `blocking`. `severity` stays the stored value.
- **Display change.** `totem rule list`, `totem rule inspect` and `totem explain` now show `error` for a rule with no stored severity, the severity the linter has always acted on; they previously showed `warning`. The compile's own per-rule log line is unchanged here, so this pull request's files stay disjoint from the guard pull request of mmnto-ai/totem#3036, which edits `compile.ts`.

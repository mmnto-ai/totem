## Lesson — One blocking predicate: hard tier and effective severity

**Tags:** lint, rule-tier, blocking, severity, cli

**Applies-to:** boundary, presentation

**Scope:** packages/core/src/rule-tier.ts, packages/cli/src/commands/run-compiled-rules.ts, packages/cli/src/commands/rule.ts

Since mmnto-ai/totem#3038 whether a rule blocks `totem lint` is one core predicate, `isBlockingRule` (`rule-tier.ts:38` at `b0a5b335`): the tier is `ruleClass` when set, else the engine fallback (`ast` and `ast-grep` are hard, `regex` is advisory), and the rule blocks when the tier is hard AND `effectiveSeverity` is `error`, where `effectiveSeverity` is `severity ?? 'error'`, the linter's default since mmnto-ai/totem#576. The linter's exit (`run-compiled-rules.ts:840-843`) and `totem rule list --blocking` share it, and the predicate equals the pre-change inline expression for every input. `rule list --json` rows carry `tier` and `blocking`; `rule list`, `rule inspect` and `explain` display `error` for a row with no stored severity, where `explain` printed `warning` before the fold and so disagreed with `rule inspect` on one row (the read's material finding; the compile's own per-rule log line at `compile.ts` ~316 still defaults to `warning` in its output). `isHardEngine` in the linter is the engine-fallback half written a second time for the frozen-lesson wording only and never decides blocking. Not shared: `totem lint --pr-comment` still counts its posted FAIL by finding severity over every violation (`pr-comment.ts:229`), so an advisory regex rule at `error` posts FAIL while the run exits 0; routed as mmnto-ai/totem#3037. A measurement limit for the Lite build: `index-lite.js` from `pnpm build` cannot run, since it reads the bundling step's `__TOTEM_VERSION__` define, so a Lite registration is verified by inspection against the main one, not by a run. At the merge the blocking set was 4 of 385 active rules.

**Source:** mcp (added at 2026-10-11T18:28:32.420Z)

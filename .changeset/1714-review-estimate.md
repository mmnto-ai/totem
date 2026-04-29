---
'@mmnto/cli': patch
---

`totem review --estimate` — pre-flight deterministic-rule estimator.

Closes mmnto-ai/totem#1714. Adds `--estimate` to `totem review`: runs the same compiled-rule engine as `totem lint` against the diff resolved by `totem review`'s standard chain (`--diff` → `--staged` → working-tree → branch-vs-base) and returns immediately. No orchestrator, no embedder, no LanceDB — the entire LLM Verification Layer is structurally unreachable from this code path. Output is labeled `[Estimate]` (a new `ESTIMATE_DISPLAY_TAG` distinct from `[Review]`) so log lines unmistakably read as a forecast rather than a final verdict.

Composes on top of mmnto-ai/totem#1715's `.totem/recurrence-stats.json` substrate as part of the bot-tax cluster (`#1713 totem retrospect`, `#1714 totem review --estimate`). The optional pattern-history overlay is filed separately as mmnto-ai/totem#1731.

Mutually incompatible with `--learn`, `--auto-capture`, `--override`, `--suppress`, `--fresh`, `--mode`, and `--raw` — these only apply to the LLM path. The incompatibility guard fires before any other validation so the error message names the actual conflict (`--override is incompatible with --estimate`) rather than a misleading downstream constraint. Empty-diff runs do NOT stamp the `.reviewed-content-hash` push-gate cache: an estimate is a forecast, not a passing review.

---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
'@totem/pack-agent-security': minor
---

`totem stats --pattern-recurrence` — cross-PR recurrence clustering substrate.

Closes mmnto-ai/totem#1715. Fetches bot-review findings (CodeRabbit + Gemini Code Assist) across the most recent merged PRs (`--history-depth`, default 50, capped at 200), folds in trap-ledger `override` events as co-equal signals, clusters them by a normalized signature (paths + line numbers + code-fence content stripped), filters out clusters covered by an existing compiled rule via Jaccard ≥ 0.6 keyword-overlap on the rule's `message`, and writes the surviving patterns at-or-above `--threshold` (default 5) to `.totem/recurrence-stats.json`. The console summary shows the top 5 by occurrence count.

This is the substrate of truth for the upcoming `totem retrospect <pr>` (mmnto-ai/totem#1713 bot-tax circuit breaker) and `totem review --estimate` (mmnto-ai/totem#1714 pre-flight estimator) — patterns from those features will read this file rather than re-scan PR history per invocation.

Output shape is versioned (`version: 1`), stable, and Zod-validated; consumers can parse against `RecurrenceStatsSchema` exported from `@mmnto/totem`. Atomic writes via temp + rename keep concurrent invocations safe.

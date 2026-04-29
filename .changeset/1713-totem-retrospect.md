---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
'@totem/pack-agent-security': minor
---

`totem retrospect <pr>` — bot-tax circuit-breaker (mmnto-ai/totem#1713).

Closes mmnto-ai/totem#1713. Reads a PR's bot-review history live, groups findings into push-based rounds via each review submission's `commit_id` (one round per push, not one round per submission), enriches each finding with cross-PR-recurrence flags read from `.totem/recurrence-stats.json` (mmnto-ai/totem#1715 substrate, read-only) plus rule-coverage flags read from `.totem/compiled-rules.json`, and emits a deterministic verdict per finding: `route-out`, `in-pr-fix`, or `undetermined`. The classifier is a fixed table over the four-axis cube `(severityBucket × roundPosition × crossPrRecurrenceBucket × coveredByRule)`; route-out reasons come from a closed catalog so the report doesn't accumulate one-off prose strings.

No LLM. No GitHub mutation. Read-only outside the optional `--out <path>` JSON write. Sub-threshold runs exit 0 with a benign skip message; `--force` overrides. The no-LLM invariant is locked down by both a static-source-grep guard (mirrors `totem review --estimate` from mmnto-ai/totem#1714) and a runtime check that every dynamic import in the command file resolves to a non-LLM module.

New CLI surface: `totem retrospect <pr-number>` with `--threshold <n>` (default 5), `--force`, `--out <path>`. Requires `gh` authenticated against the repo. The `--auto-file` flag proposed in the auto-spec is intentionally deferred to a follow-up ticket (mass-filing is irreversible; v0.1 emits suggested issue titles + bodies the human can copy-paste).

New core surface: `RetrospectRoundSchema`, `RetrospectClassificationSchema`, `RetrospectFindingSchema`, `RetrospectReportSchema` plus pure helpers `groupFindingsByRound`, `classifyFinding`, `buildStopConditions`, `computeDedupRate`, `signatureOfBody`, `toRoundPosition`, `toCrossPrBucket`. `toSeverityBucket` is now exported from `@mmnto/totem` so the bot-tax cluster (`#1715` + `#1714` + `#1713`) shares one severity vocabulary. `GitHubCliPrAdapter` gains a `fetchReviews(prNumber)` method that reads `gh api repos/.../pulls/N/reviews --paginate` for `commit_id` + `submitted_at` (the existing `fetchPr` JSON shape doesn't include `commit_id`).

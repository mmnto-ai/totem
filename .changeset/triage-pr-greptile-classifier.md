---
'@mmnto/cli': patch
---

fix(triage-pr): recognize `greptile-apps[bot]` across the bot-review pipeline (mmnto-ai/totem#2192)

`totem triage-pr` silently dropped greptile findings. The shared bot-author classifier (`isBotComment` / `detectBot`) only matched `coderabbit` / `gemini-code-assist`, so `greptile-apps[bot]` inline comments fell through as non-bot and the command printed "No bot review comments found. Nothing to triage." even when greptile had posted actionable findings.

- **Classifier**: `isBotComment` / `detectBot` now recognize greptile (substring match — a future `greptile-enterprise[bot]` is surfaced rather than dropped; the deliberate divergence from core `review-catch.ts`'s exact-match attribution scheme is documented inline).
- **Severity**: new `parseGreptileSeverity` (P1/P2/P3 → high/medium/low) plus a single `parseSeverityForTool` dispatch that replaces the per-tool severity ternary previously triplicated across `triage-pr`, `recurrence-stats`, and `retrospect` — so adding the next bot is a one-place change.
- **Attribution / aggregation**: greptile renders as `GT/<severity>` in triage output and is counted by `recurrence-stats`. (`retrospect`'s tool-distribution _label_ rolls greptile under `unknown` for now — widening the persisted core `RetrospectReportSchema` enum is out of scope here and tracked as a #2192 follow-on; greptile findings are still ingested and severity-bucketed.)
- **Deferred** (noted on the issue): greptile review-body / issue-comment "Comments Outside Diff" surfacing, which needs a distinct greptile body-parser + a new fetch path.

Pure recognition fix — the widened `BotTool` union and `parseSeverityForTool` make greptile a peer of CR/GCA wherever the CLI ingests bot review comments.

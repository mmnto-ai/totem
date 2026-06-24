---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(triage-pr): recognize `greptile-apps[bot]` across the bot-review pipeline (mmnto-ai/totem#2192)

`totem triage-pr` silently dropped greptile findings. The shared bot-author classifier (`isBotComment` / `detectBot`) only matched `coderabbit` / `gemini-code-assist`, so `greptile-apps[bot]` inline comments fell through as non-bot and the command printed "No bot review comments found. Nothing to triage." even when greptile had posted actionable findings.

- **Classifier**: `isBotComment` / `detectBot` now recognize greptile (substring match — a future `greptile-enterprise[bot]` is surfaced rather than dropped; the deliberate divergence from core `review-catch.ts`'s exact-match attribution scheme is documented inline).
- **Severity**: new `parseGreptileSeverity` (P0/P1/P2/P3 → critical/high/medium/low) plus a single `parseSeverityForTool` dispatch that replaces the per-tool severity ternary previously triplicated across `triage-pr`, `recurrence-stats`, and `retrospect` — so adding the next bot is a one-place change. P0 is greptile's blocking level; without it a `P0` finding would silently bucket as `info`.
- **First-class attribution**: greptile is added to the persisted core enums (`RecurrenceToolSchema`, `RetrospectFindingToolSchema`) and the shared `toSeverityBucket`, so it is attributed as its own tool in both `recurrence-stats` and `retrospect` output (not collapsed to `unknown`). Renders as `GT/<severity>` in triage output.
- **Deferred** (noted on the issue): greptile review-body / issue-comment "Comments Outside Diff" surfacing, which needs a distinct greptile body-parser + a new fetch path.

The widened `BotTool` union, `parseSeverityForTool`, and the core enum additions make greptile a peer of CR/GCA wherever the CLI ingests bot review comments.

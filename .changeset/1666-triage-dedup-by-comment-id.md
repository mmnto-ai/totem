---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

fix(cli): switch triage-pr dedup identity to deterministic rootCommentId (#1666)

Strategy upstream-feedback item 024 substrate. The previous `deduplicateFindings` used a `(file, line, body keyword Jaccard ≥ 0.3, line proximity ≤ 3)` fuzzy-merge heuristic. On `mmnto-ai/liquid-city#80` R3, GCA emitted six distinct high-severity findings on the same `(file, line)` anchor (all six anchored at the same rule-section start line because GitHub's pull-request inline-comment API requires a `line` field and GCA chose the rule-section header). The fuzzy merge collapsed all six into one entry, hiding five GCA-high findings from the triage summary.

- **Strict-by-id dedup.** `deduplicateFindings` now uses `rootCommentId` as the primary dedup primitive. Two findings with different `rootCommentId` are ALWAYS distinct, even when bodies are byte-identical and they anchor at the same `(file, line)`.
- **Body-hash fallback** for synthesized review-body findings (`extractReviewBodyFindings` emits these with `file === '(review body)'` and no `rootCommentId`). Map key is `(file, body)` directly — bounded length, no crypto cost, V8 handles long string keys natively.
- **Cross-bot independence is now a feature.** When CR and GCA independently flag the same `(file, line)`, both findings surface so consumers can read the agreement as elevated-confidence signal (per the strategy bot-nuance file's "Cross-bot agreement = elevated finding confidence" pattern). The previous fuzzy merge silently masked that signal.
- **`mergedWith` field stays on the schema, undefined in output.** Backward-compat shim so downstream display consumers don't need a coordinated rewrite.
- **`extractKeywords` and `jaccardSimilarity` helpers retained as exports** for the deferred `--no-dedup` debug flag (#TBD-follow-up) and ad-hoc analysis scripts. No longer called by core dedup logic.

Compile-pipeline failure mode shifts from "silent collapse of distinct findings" to "deterministic distinctness when API IDs differ." The 14 prior fuzzy-merge tests are rewritten to match the new semantics; the LC#80 R3 exhibit (6 distinct rootCommentIds on the same file:line) is pinned as a regression test.

Closes the strategy upstream-feedback batch from `mmnto-ai/totem-strategy#133` — items 020 (#1663), 021 (#1664), 022 (Proposal 248), 023 (#1665), 024 (#1666) all complete.

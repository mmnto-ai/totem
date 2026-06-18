---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

Wind-tunnel S4 corpus re-derivation (mmnto-ai/totem#2189 item 2) — the deterministic `selectionRule(asOfCommit)` resolver behind ADR-110 §6.

- **New pure module `@mmnto/totem` `spine/selection-rule`** — the offline, deterministic corpus predicate (no GitHub-API fields, §4): `selectionRulePredicate` (code-touching + bot + revert-itself), the two-pass `resolveSelectionRule` (drops a revert PR AND its in-window target, fail-safe when the target is out-of-window), `isCodeTouching` (frozen classifier; exclude wins at the file level), `isBotIdentity` (`[bot]` suffix), `parseRevertSha`, `parsePrNumber` (trailing `(#N)`; no-ref → skip, malformed → throw), and `diffPrSets`/`prSetsEqual` (order/duplicate-invariant set-equality).
- **`windtunnel.lock.v1` gains additive-optional `corpus.selectionRule` fields**: `codePathClassifier {includeGlobs, excludeGlobs}` (required at certifying resolve), `excludeRevertPairs` / `excludeBotPrs` (default `true`). Existing harness locks parse unchanged.
- **`totem spine windtunnel freeze` corpus-completeness (S4) is now a hard gate at the certifying phase**: it re-derives the code-touching PR set from lc's squash history and throws on any `resolvedPrs ≢ selectionRule(asOfCommit)` divergence (naming the missing/extra PRs). The harness phase stays warn-only. All git output is CRLF/path-separator normalized.

Scope note: this is item 2 of #2189. Item 1 (wire the resolver into the certifying `run`'s pre-scoring gate) remains open on strategy#516.

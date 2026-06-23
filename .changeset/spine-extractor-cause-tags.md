---
'@mmnto/totem': minor
---

spine: extractor NO-DRAFT cause-tags (strategy#709 yield-fix slice α) — make the moat measurable

The first Gate-1 cert run was honest-negative, dominated by the extract→draft step returning `[]` on threads carrying mintable classes. A bare `[]` conflated ≥6 distinct causes (model declined / parser rejected a valid draft / transient invoke failure) that the frozen replay discarded at record time, so the loss was un-diagnosable.

This slice widens the `DraftExtractor` port to a `DraftResult` (`{ drafts, noDraftCause? }`) — the extract-stage twin of the classifier's `dispositionSource`, a non-FM Tenet-19 diagnostic:

- **`NoDraftCause`** (core): a pinned-order, mutually-exclusive partition over every empty path — `invoke-error` (adapter) / `empty-output` / `none-sentinel` / `unparseable-shape` / `non-array` / `all-filtered` (parser) — plus a replay-migration-only `legacy-unknown`.
- **Boundary parse** in `runExtractStage` (mirrors `ClassifierResultSchema.parse`): a contract-violating result (cause-without-empty / empty-without-cause) fails loud; the recorded `noDraftCause` lands on the empty-draft drop-ledger entry.
- **Replay** records the full `DraftResult`; a backward-compatible union reader keeps pre-cause-tag fixtures (bare `string[]`) loadable + byte-identical, normalizing them on read (empty → `legacy-unknown`).

Pure instrumentation — no behavior change to drafts or drops; the NO-DRAFT cause becomes observable on the next re-record. Observability-first prerequisite for the β (normalization) and γ (RESOLVED-eligibility) yield levers.

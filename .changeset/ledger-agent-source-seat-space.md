---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

Reconcile `agent_source` with amended ADR-078 (value space = seat-id ∪ {human}, strategy#879 / #2362 fold-1). Core: widen the `LedgerEventSchema` field from the closed vendor enum (`claude`/`gemini`/`human`) to an open trimmed non-empty string — the seat roster is open-ended, and `readLedgerEvents` silently skips schema-invalid lines, so a closed set turns seat-attributed events into data loss. CLI: the scaffolded Claude SessionStart hook now stamps the env-derived seat from `TOTEM_SELF_AGENT` (first non-empty comma entry, matching the MCP producer's parse) instead of the hardcoded vendor literal `'claude'`, and omits the field when the env var is absent (Tenet 4: stamp absence, never guess). Legacy vendor-class values from pre-amendment writers remain parseable; no migration needed. (#2389)

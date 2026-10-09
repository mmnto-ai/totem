---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

**Added refusal: the legacy lesson compile refuses a record-managed serving file, and never drops a record-path row.** This is part B1 of mmnto-ai/totem#3036, the compile guard; the record writer it points to, `totem rule serve`, is part B2 and is not in this release.

- **Refusal (`@mmnto/cli`).** When `compiled-rules.json` holds any record-path row (a row carrying `examples`, the `isRecordPathRule` discriminator), `totem lesson compile` (and the deprecated `totem compile`) refuses before any write on every path (the rules file, the manifest, the exports), with the new error code `RECORD_MANAGED_SERVING_FILE` and a message naming the rows and `totem rule serve` as the right command. A serving file with no record-path row compiles exactly as before.
- **Override.** The new flag `--allow-record-rows` runs the compile anyway; the run keeps every record-path row.
- **Prune.** Both prune paths in the compile (the no-op branch's `pruneStaleRules` and the compile branch's inline prune, which now calls the same helper) keep every row for which `isRecordPathRule` is true. A record-path row's id is a ledger rule id, never a lesson hash, so it used to read as stale and be dropped.
- **Callers.** `totem doctor --pr`'s upgrade phase and `totem init`'s cursor ingest call the compile; each reports the refusal in its existing failure line and carries on with its other phases.
- **Hints (`@mmnto/totem`, `@mmnto/cli`).** The `verify-manifest` failure hint and the invalid-`compiled-rules.json` hint in the core loaders now say to use `totem rule serve` for a record-managed file. `TotemErrorCode` gains `RECORD_MANAGED_SERVING_FILE`. The installed pre-push hook's text is unchanged.

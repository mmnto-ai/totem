---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

**Added refusal: the legacy lesson compile refuses a record-managed serving file, and never drops a record-path row.** This is part B1 of mmnto-ai/totem#3036, the compile guard; the record writer it points to, `totem rule serve`, is part B2 and is not in this release.

- **Refusal (`@mmnto/cli`).** When `compiled-rules.json` holds any record-path row (a row carrying `examples`, the `isRecordPathRule` discriminator), `totem lesson compile` (and the deprecated `totem compile`) refuses before any write on every path (the rules file, the manifest, the exports), with the new error code `RECORD_MANAGED_SERVING_FILE` and a message naming the rows and `totem rule serve` as the right command. The guard reads the file once more per run, and a file that fails its schema is now reported by the guard before the option and config checks that used to come first; a readable file with no record-path row then compiles as before.
- **Unreadable file.** A `compiled-rules.json` that exists but cannot be parsed as JSON (a conflict marker, a BOM, truncation) is refused too, before any write, with `PARSE_FAILED`. The loader reads such a file as empty, so the compile used to overwrite it without its record rows. This refusal is not lifted by `--allow-record-rows`: an unreadable file could hold record rows. Repair the file (for example restore it from git) first.
- **Override.** The new flag `--allow-record-rows` runs the compile anyway; the run keeps every record-path row. For a manifest refresh or an export-only run on a record-managed file, pass it with `--refresh-manifest` or `--export`.
- **Prune.** Both prune paths in the compile (the no-op branch's `pruneStaleRules` and the compile branch's inline prune, which now calls the same helper) keep every row for which `isRecordPathRule` is true. A record-path row's id is a ledger rule id with the same 16-hex shape as a lesson hash; it matches no current lesson's hash, so it used to read as stale and be dropped.
- **Callers.** `totem doctor --pr`'s upgrade phase and `totem init`'s cursor ingest call the compile; each reports the refusal in its existing failure line and carries on with its other phases.
- **Hints (`@mmnto/totem`, `@mmnto/cli`).** The `verify-manifest` failure hint and the invalid-`compiled-rules.json` hint in the core loaders now say to use `totem rule serve` for a record-managed file. `TotemErrorCode` gains `RECORD_MANAGED_SERVING_FILE`. The installed pre-push hook's text is unchanged.

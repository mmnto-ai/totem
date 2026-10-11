## Lesson — A record-path row is marked by examples, and the legacy

**Tags:** compile, record-path, serving-file, lazy-boundary, spine

**Applies-to:** mutator, boundary

**Scope:** packages/cli/src/commands/compile.ts, packages/core/src/spine/record-runtime.ts

The serving file's record-path discriminator is the `examples` field (`isRecordPathRule`, core `record-runtime.ts:83` at `b0a5b335`); `curation` is not it, and at the merge 0 of 485 rows carried it. Since mmnto-ai/totem#3039 the legacy compile's two prune sites route through one async helper, `pruneStaleRules`, which keeps a row when `isRecordPathRule(row)` or its lesson hash is current, and reaches the discriminator through the CLI's lazy `@mmnto/totem` boundary (hence async), because the record `mig-2266fc0d` bans a static named value import from the barrel in `packages/cli/src/commands/**`; a third prune site that drops rows by lesson hash does not exist in cli, core, mcp or the packs. The compile refuses a serving file holding any record-path row with `RECORD_MANAGED_SERVING_FILE` before any write, naming `totem rule serve`, unless `--allow-record-rows`; `doctor --pr`'s upgrade phase and `init`'s cursor ingest print the refusal and carry on with their other phases. Two hint clauses the scoped re-read falsified before merge: `--export` is export-only ONLY when no orchestrator is configured (`compile.ts:1183` runs Phase 1 whenever one is; `:2054` is the export-only path), so on a Full-tier config `--export` is a full compile that keeps every record-path row; and the deprecated `totem compile` alias registers `--allow-record-rows` but not `--refresh-manifest`, so a manifest refresh on a record-managed file is `totem lesson compile --refresh-manifest --allow-record-rows`. A lowered row's id has the same 16-hex shape as a lesson hash (`compiler-schema.ts:239`, an optional `-<n>` suffix); what makes a row stale is matching no current lesson's hash, not its shape.

**Source:** mcp (added at 2026-10-11T18:28:28.508Z)

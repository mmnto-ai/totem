## Lesson — When a manifest gains a new attested file class, every

**Tags:** manifest, attestation, freshness, single-homing, tenet-20, trap

When a manifest gains a new attested file class, every WRITER and every FRESHNESS / no-op decision path must consult ONE predicate for that class. Prop 310 slice 3 added `records_hash` to `compile-manifest.json` and wired all six `writeCompileManifest` callers plus the `--refresh-manifest` freshness test — but the ordinary `totem compile` no-op path derived `manifestStale` from `input_hash` alone, so a tracked record-only edit was never rewritten and `verify-manifest` then hard-FAILed (CodeRabbit Major, outside the diff, mmnto-ai/totem#2668). Cure shape: a single exported predicate (`isRecordsAttestationFresh(existingHash, totemDir, cwd)`) shared by the verifier, the refresh path, and the no-op path, with a regression row "tracked record-only change ⇒ manifest rewritten, rules file byte-identical" and its negative control "nothing changed ⇒ manifest byte-identical". Sweep with `grep` for every site that decides "is the manifest fresh?", not only the sites that write it.

**Source:** mcp (added at 2026-08-22T05:59:32.040Z)

---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(orchestrator): grounding bundle with day-one provenance classes (#2101, strategy#474 slice 2).

Every run artifact now carries a per-item `grounding.bundle`: each delivered evidence item self-describes its provenance class (`similarity-only` | `structurally-verified` | `spec-contract` | `compiled-rule` — open vocabulary with canonical constants, consumers fail-safe-down on unknown classes), its identity (`sourceType`, `filePath`, optional `sourceRepo`; absent = the run's own repo), and a `contentHash` (identity, never bytes — the masked prompt already carries content once). The first cut wraps existing retrieval honestly as `similarity-only`; structural resolvers (#344/#375) graduate items later. `grounding.hash` becomes the deterministic hash of the bundle (recomputable from the artifact surface alone) and `provenanceSummary` is derived as a sorted class-count string (`similarity-only:14`; zero items → `ungrounded`). Bundle items are canonically sorted so retrieval order never moves the hash. Reruns carry the bundle verbatim. `RUN_ARTIFACT_SCHEMA_VERSION` bumps to 1.1.0 (additive; the version-tolerant reader parses slice-1 artifacts unchanged — they cannot be re-classed and stay as-is). New core exports: `GroundingItemSchema`, `GroundingBundleSchema`, `buildGroundingBundle`, `summarizeProvenance`, `PROVENANCE_CLASSES`, `PROVENANCE_UNGROUNDED`.

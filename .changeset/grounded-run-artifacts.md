---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(orchestrator): grounded single-run artifact + rerun/compare primitives (#2100, strategy#474 slice 1)

Every opted-in orchestrator run (spec + review standard verdict, always-on) now emits an immutable, content-addressed JSON record under `.totem/artifacts/runs/<sha256>.json`: the post-DLP masked prompt bundle, grounding hash + provenance summary (`similarity-only` wholesale in this slice), the RESOLVED backend (post quota-fallback) with admission class, and the output + metrics. Response-cache hits emit nothing — artifacts record actual invokes. Emission is strictly additive (`runOrchestrator` return contract unchanged; non-opted callers byte-identical) and never fails the run.

New primitives + thin verbs: `totem artifact rerun <hash>` re-invokes the exact stored bundle against the recorded backend (bypassing retrieval AND the response cache) and appends a new record; `totem artifact compare <a> <b>` returns a deterministic structural diff (equality flags, content hashes, numeric metric deltas — no similarity scoring). Core exports `RunArtifactSchema` with a version-tolerant reader (accepts any 1.x; migration-on-read registry for majors) so the accumulated fixture corpus survives schema evolution.

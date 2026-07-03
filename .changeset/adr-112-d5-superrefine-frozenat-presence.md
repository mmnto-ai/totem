---
'@mmnto/totem': patch
---

feat(spine): ADR-112 D5 follow-on — parse-time `frozenAt` presence guard on the authored seed (strategy#804 couple ruling, ACCEPT). `CertCorpusSeedSchema`'s outer `superRefine` now rejects `producerKind:'authored'` without `split.frozenAt` at parse: an authored seed lacking the pre-authoring freeze instant is invalid-by-construction (the materialize Q3 gate is production-unsatisfiable without it — #2287 couple HOLD), so acceptance at parse only let provably-dead state travel to materialize before failing. Layered clauses, not a dual home: parse-time owns PRESENCE; the materialize-time `GATE_INVALID` remains the enforcement home for temporal SEMANTICS (ordering vs `authoredAt`, loaded-not-stamped sourcing) and still guards programmatic (non-parse) callers. Mined seeds are byte-unaffected (the clause is `producerKind`-conditional).

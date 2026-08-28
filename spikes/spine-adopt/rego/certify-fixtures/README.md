# Certification conformance fixtures (spec § Actuator slice 5)

HAND-AUTHORED, never generated. `src/lower.mts` cannot produce these: § Lowering 4's
engine gate REJECTS a lookaround or backreference pattern at lowering time, which is
exactly the property under test. To exercise the layer BELOW the lowerer, these
policies are written by hand in the lowered-policy shape and fed straight to pinned
`opa build -t wasm` — which accepts them (exit 0, a valid module) and defers the
failure to evaluation. That deferral is the measured fail-open the certification
actuator exists to close.

| Fixture                 | Provenance                                                                                    | What it proves                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `neg-lookahead/`        | corpus rule `e64911592b774cc6` (`pack-agent-workflow`), census class `lookaround`             | a negative-lookahead pattern reaches `opa build` intact, builds clean, and yields an UNDEFINED `result` at eval — certification must BLOCK, and every host must produce an error row |
| `backreference/`        | corpus rule `80192e6ac2a1dd3c` (`root`), census class `backreference` — the corpus's only one | same, via the other inexpressible class (`invalid escape sequence: \1`)                                                                                                              |
| `two-entrypoints/`      | authored control, no corpus source                                                            | the § Actuator slice 4 only-exported-result-path assertion has TEETH: BOTH entrypoints classify PASS, so the block is attributable to the entrypoint-set assertion alone             |
| `classifier-controls/*` | authored controls, no corpus source                                                           | each of the five typed blocked reasons is REACHABLE — a classifier that could only ever return one verdict would prove nothing                                                       |

The target patterns are transcribed from `artifacts/expressibility-census.json`, and
`src/certify.mts` re-reads that artifact and asserts the transcription is
byte-exact against the corpus row before building anything. A fixture that had
drifted from its corpus provenance would fail the run, not pass quietly.

Built artifacts land in `build/` (gitignored). The two negative fixtures' wasm is
retained there for forensics and is never chained (spec § Actuator slice 2).

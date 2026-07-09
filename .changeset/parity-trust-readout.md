---
'@mmnto/cli': minor
---

feat(doctor): `--parity` trust-readout — verdict rollup (per-seat + global), run-time coverage denominator (mechanical / attestation-only / honest-absent), why-not per non-PASS row at the senses level probed, `--json` verdict artifact, and the `--strict` declaredly-toothless honesty line (Prop 303 §5(a) spec-to-build, mmnto-ai/totem#2327).

Consumer-impact: CLI surface — `totem doctor` gains a `--json` flag (valid only with `--parity`; `doctor --json` without it now errors explicitly instead of silently ignoring the flag), and `doctor --parity` output gains the trust-readout tail after the per-row lines. Exit-code semantics are unchanged (`--strict` still exits non-zero iff a blocking contract drifted). Scripts that parse `doctor --parity` stdout/stderr line-by-line should anchor on the per-row `[Parity]` lines, which are byte-compatible; the readout is additive.

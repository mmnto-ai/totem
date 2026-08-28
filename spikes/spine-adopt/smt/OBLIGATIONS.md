# The ten proof obligations (SMT spike, spec § Spike 2)

Encodings target the SMT theory of strings + regular expressions (`str.in_re`, `re.++`, `re.union`,
`re.inter`, `re.comp`, `re.range`) — supported by BOTH Z3 and cvc5, which is what makes the
solver-neutral boundary testable. Each obligation is stated as the PRODUCT question it proves,
then the SMT shape. Deliberate class coverage per the ruled criteria: contradiction (O1, O2),
exhaustiveness (O3, O4), set membership (O5, O6), regex/string constraints (O7, O8, O9),
deliberate timeout (O10). Every obligation runs on both solvers; the harness records
status, model-or-core hash, wall time, and agreement.

Obligations O1/O5/O6/O8 are live defect classes, not synthetic: O1 generalizes the
mmnto-ai/totem#2678 vacuous-suppression miss, O8 is the mmnto-ai/totem#2680 self-blinding
suppression class, O5/O6 are the dead-scope/dead-matcher classes the curation probes keep finding.

| # | Product question | SMT shape | Expected |
|---|---|---|---|
| O1 | **Requires-vacuity** (mmnto-ai/totem#2678 class): does `requires.pattern` match every line that `target.pattern` matches — i.e. can the rule EVER fire? | `∃s: s ∈ L(target) ∧ s ∉ L(requires)` — SAT = rule can fire (witness line = countermodel); UNSAT = vacuous | SAT, stable witness |
| O2 | **Dead matcher**: is `L(pattern)` empty (contradictory construction)? | `∃s: s ∈ L(p)` with `p = re.inter(A, re.comp(A))`-shaped input | UNSAT + unsat core |
| O3 | **Severity vocabulary exhaustiveness**: is every record severity in the closed set? | `s ∈ L(error|warning)` per specimen, plus the negative control `s = "info"` | SAT ×5, UNSAT control |
| O4 | **Fixture differential** (the C4 obligation, per pair): bad ∈ L(pattern) ∧ good ∉ L(pattern) | conjunction over specimen (a)'s inline pair, line-anchored | SAT (both conjuncts) |
| O5 | **Scope emptiness**: does any path match `fileGlobs` ∧ not `excludeGlobs`? (globs lowered to regex over the path alphabet) | `∃p: p ∈ L(G⁺) ∧ p ∉ L(G⁻)` for specimen (e)'s scope | SAT, witness path |
| O6 | **Exclusion subsumption** (dead rule by scope): `L(G⁺) ⊆ L(G⁻)` — every in-scope file is excluded | `¬∃p: p ∈ L(G⁺) ∧ p ∉ L(G⁻)` on a constructed subsuming pair | UNSAT + core |
| O7 | **Rule subsumption/redundancy**: `L(p_A) ⊆ L(p_B)` for two corpus patterns with known overlap (the `09ee3725` lookahead-vs-requires control, RE2-expressible parts) | `∃s: s ∈ L(p_A) ∧ s ∉ L(p_B)` | measured (either), agreement required |
| O8 | **Self-suppressing pattern** (mmnto-ai/totem#2680 class): does `L(pattern)` intersect the suppression-directive language `.*totem-ignore.*`? | `∃s: s ∈ L(p) ∧ s ∈ L(.*totem-ignore.*)` on a constructed offender + a clean control | SAT offender, UNSAT control |
| O9 | **Word-boundary desugar equivalence** (feeds the census): is a `\b`-desugared RE2 form equivalent to the intended language on the line alphabet? | `∃s: s ∈ L(orig′) ⊕ s ∈ L(desugar)` (xor-emptiness = equivalence) on specimen (a)'s pattern | UNSAT (equivalent) or witness |
| O10 | **Deliberate timeout, fail closed**: nested `re.inter` chain over long ranges engineered past the budget | any — the ASSERTION is that the harness reports `timeout/unknown` and the pipeline treats it as NOT-PROVEN (no pass-through) | timeout on ≥1 solver |

## Evidence contract (the R2-shaped chain)

Per obligation the harness persists: the SMT-LIB2 text (also replayable via the pinned CLI binaries
— the process-boundary fallback posture exercised for free), solver name+version, status,
countermodel (SAT) or unsat core (UNSAT) where the binding exposes it, and sha256 of each. The
chain artifact binds `sha256(obligation source) → sha256(emitted SMT-LIB) → sha256(evidence)`.
PASS per the ruled criteria: both solvers agree on every decidable obligation; countermodels
stable across two runs; O10 fails closed on both bindings; Windows build passes for whichever
binding is selected (Linux via CI). Any unexplained disagreement ⇒ no solver adoption; the
SMT-LIB process boundary (already exercised as the replay path above) becomes the recorded
fallback posture.

## Binding notes

- Primary: `z3` crate (prove-rs) — build against the pinned Z3 5.1.0 release libs
  (`Z3_SYS_Z3_HEADER` / lib path from `tools/z3-5.1.0-x64-win`), avoiding a from-source cmake build.
- Challenger: `cvc5` via its Rust binding if it builds on Windows against the pinned 1.3.4 static
  libs; otherwise the challenger runs through the SMT-LIB process boundary against the pinned CLI —
  that is a legitimate spike outcome (record it as the binding-maturity finding, per the deposit's
  "not the default abstraction" note on process boundaries).
- Glob→regex lowering for O5/O6 is the spike's own (path alphabet = printable ASCII minus NUL;
  `**`/`*`/`?` per the § Design 7 profile) — documented beside the encoding, since its fidelity
  bounds what O5/O6 prove.

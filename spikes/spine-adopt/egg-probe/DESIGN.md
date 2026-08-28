# egg e-graph probe (spec § Enrichment row 1) — "egg proposes, Z3 disposes"

## Question

Does e-graph rewriting (the `egg` library — egglog's engine-class ancestor, stable on crates.io)
buy the Spine's DSL→IR normalization anything a hand-written normalizer doesn't, at bounded cost —
measured on the REAL corpus, with every claimed equivalence externally verified?

## Falsifiable adoption check (pre-registered)

ADOPT-for-study only if ALL of:

1. **Soundness 100%:** every equivalence egg claims (two syntactically-distinct corpus patterns in
   one e-class, or a rewritten form vs its original) is verified UNSAT by the Z3 xor-emptiness
   construction (the O9 shape: `∃s: s ∈ L(A) ⊕ s ∈ L(B)` — UNSAT = equivalent). ONE unsound merge
   ⇒ REJECT (an unsound normalizer inside a proof pipeline is disqualifying, not fixable-later).
2. **Non-syntactic yield ≥ 1:** egg finds at least one equivalence class in the corpus that naive
   syntactic dedup (exact string match after whitespace normalization) does not — i.e. it earns its
   keep on real rules, not constructed examples.
3. **Bounded cost:** full-corpus saturation completes under a declared budget (60s wall, default
   egg iteration limits); a blowup is a REJECT row with the measurement.
   Otherwise: **REJECT — plain typed IR structures win** (codex Q-GAP row 3's default), recorded with
   the numbers.

## Method

1. **Regex→IR parser for a declared subset**: literals, character classes (incl. ranges/negation),
   `.`, alternation, concatenation, `*`/`+`/`?`, bounded `{n,m}`, non-capturing + capturing groups
   (structure-only), anchors, escaped classes (`\s\d\w\S` etc.), `\b` via the CAREFUL desugar (the
   O9-verified one, not the naive one). Input: the 177 RE2-expressible corpus patterns
   (`re2-clean` 107 + `word-boundary` 70 from `artifacts/expressibility-census.json`). Patterns
   outside the subset are enumerated `unparsed` — an honest bound, not silent drops; assert
   parsed + unparsed = 177.
2. **egg language + rewrite ruleset** (small, each rule named): union assoc/comm/idempotence,
   concat assoc + ε-identity, `∅` annihilator/identity laws, `(a*)* → a*`, `a?·a* → a*`,
   `a·a* ↔ a+`, char-class union merging, single-char class ↔ literal. NO rule that is not locally
   provable; the ruleset is part of the deliverable.
3. **Saturate per pattern** (canonical form + cost via ast-size extractor), then group the corpus
   by canonical e-class. Report: syntactic-distinct count vs e-class count; every cross-pattern
   merge listed.
4. **Verification pass:** for every cross-pattern merge AND for a 20-pattern random-free sample of
   (original, extracted-canonical) pairs (seeded deterministically from pattern hashes — no RNG),
   emit SMT-LIB2 xor-emptiness and run the PINNED z3 CLI — resolved PER PLATFORM the way the rest
   of the spike resolves its pinned solvers: `$SPIKE_Z3_BIN` when set, else
   `tools/z3-5.1.0-x64-win/bin/z3.exe` on Windows and `tools/z3-5.1.0-x64-glibc-2.39/bin/z3`
   elsewhere (both assets pinned in `toolchain.lock`, `[z3]` / `[z3.linux]`), with a 30s timeout
   each; a timeout = the pair is recorded UNVERIFIED and criterion 1 treats it as not-proven —
   fail closed, same posture as O10. The
   probe emits its own SMT-LIB (self-contained printer for the subset); it does NOT modify or
   depend on the `smt/` crate.
5. **Artifacts** (`egg-probe/artifacts/`): `egg-report.json` — parsed/unparsed counts, e-class vs
   syntactic counts, every merge with its z3 verdict, saturation timings, the adoption-check
   verdict against the three criteria; `verification/` — the .smt2 + z3 outputs; `ruleset.json`.

## Boundaries

Own crate at `spikes/spine-adopt/egg-probe/` (empty `[workspace]`, committed Cargo.lock, `egg`
pinned). Reads census artifact + corpora JSON + pinned z3; writes only under `egg-probe/`. No
changes to `smt/`, `host/`, `src/`, or anything else. The probe is study-grade evidence for the
deposit's egglog row — a pass adopts nothing by itself.

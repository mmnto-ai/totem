# Spec: spine-spike — the adopt-round spike pair (OPA Rego→Wasm differential + Z3/cvc5 solver spike)

> Provenance: `totem spec spine-spike`'s LLM draft (run artifact `a181373698b0…`) grounded itself in
> the spine mining/freeze surfaces (freeze-proof, fixture-ancestry, classify), which are not this
> task; body replaced by hand from the ruled sources. Design source of record (operator word
> 2026-08-27, relayed strategy-claude 2026-08-27T2024Z): **strategy-codex's adopt-round deposit
> 2026-08-27T19:24Z, Q1 ranks 1–2 + Q-GAP, verbatim** — plus the round's three enrichment rows.
> Durable record: mmnto-ai/totem-strategy#1138.

### Problem statement

Before the first Rust core crate exists, decide adopt-vs-build for two Spine layers with
disposable, freeze-safe spikes that produce the adoption **decision** (a pass adopts nothing by
itself):

1. **Rego/Wasm layer** — can pinned `opa build -t wasm` + a Rust OPA-Wasm host
   (`matrix-org/rust-opa-wasm` over Wasmtime) replace a Totem-owned Rego compiler / Wasm emitter /
   ABI host, reproducing the shipped record runtime's verdicts exactly?
2. **SMT layer** — can `prove-rs/z3.rs` behind a solver-neutral proof-obligation boundary (with
   `cvc5-rs` as the mandatory challenger) carry ADR-103's proof-required-for-enforcement crossing,
   including the evidence needed for the certificate chain?

### Architectural context (constraints that bind the spike)

- **ADR-103 Amendment 2026-08-19:** Rego is REJECTED as an _authoring surface_; **G1's Rego
  compilation _target_ stands** (surface-only rejection). This spike exercises the compilation-target
  lane only: records remain the authoring surface; the spike's disposable lowerer translates
  record semantics to a bounded Rego subset.
- **Prop 310 (record grammar):** `verification_shadow` is carried verbatim, never evaluated at V1;
  "any OPA wiring per Amendment R1's **probe pin**" — this spike is that probe class. Amendment R2's
  certificate chain (**source hash → IR hash → artifact hash**) is exactly the spike's hash-chain
  deliverable. Prop 270 §6.3 already sketches `rego → OPA evaluator` dispatch as the eventual shape.
- **Freeze-safety:** the `rule-compilation` freeze is untouched; no production wiring; nothing under
  `packages/*` changes. Spike code lives in `spikes/spine-adopt/` on branch `wt/spine-spike`
  (registered worktree). Deliverables are artifacts + a decision report, not merged product code.
- **467 replay window (coordination, not a gate):** work stays on this branch; commits in bursts.
- **Corpus facts (ADR-103 Amendment):** 485 compiled rules — 217 regex; 19 compound NapiConfig
  rules; requires: (§ Design 8) is a safe-regex2-gated regex evaluated textually at declared scope,
  two-pass (target match → scoped requirement check), with `scope: line` rejected on ast-grep
  targets (span-vs-line ruling).

### Spike 1 — OPA Rego→Wasm verdict differential (~2 seat-days)

Per the design source, verbatim criteria:

- Lower **five representative V1 records** — one each: regex, flat ast-grep, compound ast-grep,
  `requires:`-bearing, exception/exclusion-bearing — to a bounded Rego subset; compile with
  **pinned OPA**; evaluate with rust-opa-wasm on Wasmtime; compare per-fixture verdicts against the
  shipped record runtime. `microsoft/regorus` runs as reference differential only (never a silent
  semantics replacement).
- **PASS** = identical verdicts on every registered good/bad fixture; repeatable artifact hash;
  all imports/builtins enumerated; no network; bounded cold/warm runtime recorded.
- **FAIL/park** = any unexplained semantic mismatch, unsupported required builtin, nondeterministic
  artifact, or unbounded host import.
- Census required builtins and OPA ABI imports **before** choosing the host path.

### Spike 2 — solver-neutral Z3/cvc5 proof obligations (~2 seat-days)

- Encode **ten obligations** spanning: contradiction, exhaustiveness, set membership, regex/string
  constraints, and a deliberate timeout. `z3.rs` first; `cvc5-rs` is the mandatory challenger, not a
  second production dependency.
- **PASS** = Z3 and cvc5 agree on SAT/UNSAT; countermodels stable; the selected binding exposes
  enough unsat-core/proof material to bind source hash→IR hash→artifact hash; timeouts fail closed;
  static/vendored builds pass Windows and Linux.
- **FAIL** = unexplained solver disagreement, or inability to persist/check the required evidence →
  no solver adoption; fallback posture = a pinned SMT-LIB process boundary.

### Enrichment rows (execute with, not instead — ruled at the round)

1. **egg/egglog e-graph evaluation** on DSL→IR normalization (3-lane convergence; "likely the
   highest-leverage single eval").
2. **wazero component-model maturity check BEFORE any WASM contract freezes** (status-claude's
   Go-satellite constraint; OPA emits core Wasm — start there, WIT only if a measured cross-language
   ABI need survives).
3. **Day-14 deliverables:** solver differential table · OPA builtin/ABI census · one
   source→IR→proof/evidence→Wasm hash chain · one Wasm validation/mutation result (wasm-tools) ·
   build matrix Windows+Linux · **explicit rejects**.

### Known hazards for the lowering (pre-census)

- ast-grep matching is engine-native; the honest Rego boundary is likely **pre-computed match facts
  as input data** (Prop 270 §6.3 keeps ast-grep evaluation in its own evaluator) rather than
  reimplementing tree matching in Rego. The spike must pick and document the fact boundary — this is
  itself spike evidence (what OPA can and cannot own).
- JS regex flavor vs Rego `regex.match` (RE2 semantics): lookaheads/backreferences in corpus
  patterns will not port 1:1; any such divergence is an enumerable builtin-gap finding, not a
  silent approximation.
- `requires:` two-pass semantics (target match → scoped requirement, precondition-gated) must be
  reproduced exactly — the mmnto-ai/totem#2678 class showed how easily a gate diverges from the
  runtime here.

_Specimen selection and the runtime-seam map land in the Implementation Design below, from the
record-corpus census._

## Implementation Design

### Scope (2 sentences)

Build `spikes/spine-adopt/` on `wt/spine-spike`: five authored V1 records with per-fixture verdict
sets, a TS reference harness producing shipped-runtime verdicts through the REAL dispatchers
(`apply-rules-bounded` / `applyAstRulesToAdditions` after `compileRuleRecord`), a disposable
record→Rego lowerer, pinned `opa build -t wasm` artifacts, a Rust host crate (rust-opa-wasm on
wasmtime) + differential comparator, and a second Rust crate encoding ten proof obligations against
z3.rs with cvc5 as challenger — plus the regex-expressibility census (step 0) and the egglog/wazero
enrichment probes. It will NOT: touch `packages/*` or any freeze surface, write `.totem/rules/`
(records-hash attestation stays untouched — specimens live under `spikes/`), execute any
`verification_shadow` on a product path (the R4 gate stays uncrossed; the OPA arm is side-by-side
and inert), or adopt/wire anything — outputs are artifacts + a decision report.

### Census corrections the design binds to (explore-leg, 2026-08-27)

- **Zero V1 records exist**; the 485+15 shipped rules are all legacy (0/500 carry any of the 7
  record-home fields). The only real V1 records are `design4ExemplarRecord()` /
  `design8ExemplarRecord()` (`packages/core/src/spine/record-exemplars.fixture.ts`).
- Every regex compile site is FLAGLESS and per-added-line; `^`/`$` are string anchors on a line.
- `requires:` is a MATCH PREDICATE (satisfied ⇒ no violation AND no suppress event) with
  fail-toward-flagging (unreadable/out-of-root file ⇒ context absent ⇒ FIRES).
- Suppression is engine-level substring markers, never a record field; the record-grammar exception
  construct is `excludeGlobs` (record profile: empty positives ⇒ match NOTHING — opposite of legacy).
- ast-grep matching is native (`@ast-grep/napi`); compound trees can embed Rust-regex-crate
  expressions — two regex dialects in one record.
- SETTLED by step 0 (executed on pinned OPA v1.20.0): **`\b` IS supported** — the census leg's RE2
  table row is falsified. Inexpressible: 48 lookaround-bearing patterns + 1 backreference = 49/226
  (~22%), all rejected AT COMPILE (never a silent non-match). Escape-aware `\b` count is 99 (the
  naive 101 includes two rules matching literal `\b` text). Three measured lowering hazards bind the
  lowerer: (i) OPA is FAIL-OPEN without `--strict-builtin-errors` (exit 0 + `{}` on an uncompilable
  regex) — the lowerer and host MUST run strict; (ii) `\b` in a double-quoted Rego literal is
  BACKSPACE — emitted patterns are JSON-escaped, never verbatim; (iii) Rego raw strings have no
  escape mechanism, so the 17 backtick-bearing patterns cannot use that form.

### The five specimens (sourcing: AUTHOR them as V1 records, semantics drawn from named legacy rules)

_(Amended per the falsification fold, 2026-08-27 — see § Falsification fold.)_

| #   | Class             | Source semantics                                                                                                                                                                                                                                                                            | Fixtures / oracle                                                                                                                                                                                                                     |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | regex             | `61dcb058bd1df15d` (lessons-md rm guard); its 5 `!`-negated globs move to `excludeGlobs` (verified: parses + lowers, scope probes match legacy)                                                                                                                                             | `.totem/tests/test-61dcb058bd1df15d.md` (1F/1P) + inline pair                                                                                                                                                                         |
| b   | flat ast-grep     | `2d962603591aa928` (RegExp-in-try empty catch) **narrowed to `fileGlobs: ['**/\*.ts'], language: typescript`** — the legacy 4-extension glob set fails the language⇄glob floor (`record-lower.ts:142-146`, lowering-rejected when executed); fixture file `scripts/audit.ts` stays in scope | `test-ast-empty-catch.md` (3F/5P)                                                                                                                                                                                                     |
| c   | compound ast-grep | **`d0815b6769304e26`** (spawn shell:true; embedded `regex:"^shell$"` — the dual-dialect hazard; verified to compile as a record; `!`-negations → excludeGlobs)                                                                                                                              | `test-d0815b6769304e26.md` (3F/4P); supplementary richness arm at zero lowering cost: `87aff037d7de47a7` (8F/20P — same matcher as specimen e)                                                                                        |
| d   | requires (§ D8)   | `design8ExemplarRecord()` transcription (line arm) + its pinned `scope: file` spread-variant (`record-runtime.test.ts:358-361`)                                                                                                                                                             | verdicts pre-pinned `record-runtime.test.ts:286-395` (line 286-334, file 336-395); control: `09ee37252a814a09` (same intent via lookahead)                                                                                            |
| e   | exception         | `design4ExemplarRecord()` transcription — excludeGlobs arm; matcher deliberately shared with 87aff037 (isolates the exception axis)                                                                                                                                                         | 4 verdicts pinned `record-runtime.test.ts:397-433`; synthetic suppression arm uses plain `// totem-ignore` (NOT `totem-context:` — the fail-soft attestation machinery at `rule-engine.ts:498-510` injects an extra engine Violation) |

The two exemplar transcriptions are hand-copies of a deliberately non-exported fixture
(`record-exemplars.fixture.ts:10-13`); each is pinned against its cited source line range and the
harness asserts verdict-equality against the pinned tests before any OPA comparison.

Expressibility evidence rows (census, not specimens): the corpus lookbehind rule
(`bddfbd2ec1c75eaf` — `validateRegex` rejection EXECUTED and confirmed: "ReDoS vulnerability
detected"), the backreference rule (`80192e6ac2a1dd3c` — record-authorable, RE2-inexpressible),
and the 48 lookaround-bearing patterns (47 negative-lookahead + 1 lookbehind; occurrences 53).

### Differential units (the M2 fold — binds both arms)

- **Fixture shaping:** each fixture block is ONE whole-file source served via the dispatcher's
  `readStrategy`; every line is an addition with `precedingLine = lines[i-1]`. No per-line-as-file
  and no joined-snippet shapes (three shapes were measured to give three different cardinalities).
- **A verdict** = the violation MULTISET keyed `(ruleId, lineNumber)` for a `(rule, fixture)` pair —
  never a count of fixture lines. F/P line counts in the specimen table are corpus descriptions, not
  verdict counts.
- **`matchCount`** ≡ the shipped violation count for that pair. Shipped semantics are
  engine-asymmetric (regex: at most one per added line — `worker.ts:53-62`; ast-grep: one per match —
  `rule-engine.ts:1074`); the Rego arm must reproduce that asymmetry, not `regex.find_n` raw counts.
- **`fired` derives from violations, never from trigger events** — `astContext` gates emission after
  triggering (`apply-rules-bounded.ts:249`: measured `astContext:'comment'` ⇒ trigger event, zero
  violations). The spike feeds unclassified lines (all `code`), a configuration shipped lint
  never runs — disclosed as a spike simplification.

### Oracle arms (the P2 fold)

- **Arm 1 (pin-reproduction oracle):** `applyRulesToAdditions` — the sync dispatcher that produced
  every pinned verdict in `record-runtime.test.ts:286-395` (verified: all calls are the sync
  sibling).
- **Arm 2 (lint-path oracle):** `applyRulesToAdditionsBounded` + `applyAstRulesToAdditions` — what
  `totem lint` runs. In-process viability EXECUTED and confirmed (worker resolves as a dist sibling).
- Both arms run on all specimens with an explicit generous `timeoutMs` and
  `timeoutOutcomes.length === 0` asserted (the 250 ms default converts scheduling jitter into silent
  verdicts). Known, unreachable-for-these-specimens divergence: suppression-vs-Rust-span ordering
  differs between arms.
- **Import path (P5 ruling):** the harness file-URL-imports the built
  `packages/core/dist/index.js` (verified: every needed symbol except the exemplars is on the
  barrel; `@mmnto/totem` is not root-linked and deep imports are exports-blocked). No workspace or
  package config mutation.
- **Arm model ruling (post-build):** the two-arm contract applies to REGEX only. There is exactly
  one shipped ast dispatcher — `applyAstRulesToAdditions` is simultaneously the pin oracle and the
  lint path (the sync sibling filters ast rules out entirely; measured: 0 violations/events on all
  ast bundles). The harness records `armsCoincide: true` for ast rather than manufacturing a
  same-function "agreement"; arm agreement is asserted only where two distinct dispatchers exist.

### Data model deltas (all spike-local, under `spikes/spine-adopt/`)

- `SpikeRecord` — the 5 `.rule.yaml` sources (parsed with the exported `parseRuleRecord`); written by
  me, read by lowerer + reference harness; invariant: each parses + compiles via `compileRuleRecord`.
- `FactBundle` (JSON) — per fixture: `{file, fileText: string|null, lines[], astMatches[]}` with
  `astMatches` in `AstGrepMatch` shape, produced by a TS fact-extractor over `@ast-grep/napi`; read
  by the OPA arm as `input`. `fileText` is the RAW file text (`null` = unreadable — the M3 fold:
  `requires.scope: file` distinguishes null/empty/content, and `lines[]` loses terminators);
  `lines[]` is derived from it, whole file in order (the precondition that makes suppression
  anchor 1 derivable). Invariant: fact extraction is the ONLY ast dependency on the Rego side (the
  fact boundary is itself a deliverable finding).
- `VerdictRow` — `{ruleId, fixtureId, arm: shipped|opa|regorus, fired, matchCount, events[]}`;
  written by each arm, read by the comparator; invariant: event streams compared, not just verdicts
  (the requires predicate-vs-suppression distinction).
- `ObligationRow` — `{id, class, z3:{status,evidenceHash}, cvc5:{...}, agreement}`; ten rows exactly.
- `ChainArtifact` — `{sourceHash, irHash (lowered .rego + fact schema), wasmHash}`; the R2-shaped
  chain deliverable. No reserved keys/sentinels anywhere; absent = absent.

### State lifecycle

All state is per-run files under `spikes/spine-adopt/artifacts/`, committed in bursts on the branch
(467 replay preference); created by harness runs, never mutated in place (new run ⇒ deterministic
filenames, overwritten wholesale), destroyed only by branch disposal. No product store, cache,
manifest, or `.totem/` surface is written. Toolchain pins live in
`spikes/spine-adopt/toolchain.lock` (versions + sha256), created once, mutated only by an explicit
re-pin commit.

### Failure modes

| Failure                                              | Category  | Agent-facing surface                                          | Recovery                                               |
| ---------------------------------------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| opa/z3/cvc5 binary missing or version ≠ pin          | init      | hard error naming the pin                                     | install per lock; re-run                               |
| pattern inexpressible in Rego regex                  | runtime   | enumerated REJECT row in census artifact                      | none needed — that IS the finding                      |
| ast fact-extractor output diverges from engine match | runtime   | differential FAIL row                                         | fix extractor; divergence class recorded               |
| verdict mismatch shipped vs OPA                      | runtime   | the measured outcome — classified per the deposit's PASS/FAIL | explained ⇒ documented; unexplained ⇒ spike FAIL/park  |
| solver disagreement Z3 vs cvc5                       | runtime   | FAIL row (no solver adoption)                                 | fallback posture: pinned SMT-LIB process boundary      |
| solver timeout (the deliberate arm)                  | runtime   | must fail CLOSED; a fail-open pass is a spike FAIL            | assertion in harness                                   |
| z3-sys/cvc5 build fails on Windows                   | permanent | recorded build-matrix row                                     | SMT-LIB process-boundary fallback, explicitly recorded |
| wasm host needs import beyond OPA ABI                | runtime   | FAIL per deposit (unbounded host import)                      | none — reject row                                      |
| nondeterministic wasm artifact hash                  | runtime   | FAIL per deposit                                              | none — reject row                                      |

No silent-degradation rows exist: every skip/reject is an artifact row (Tenet 4).

### Invariants to lock via tests (spike-internal)

- The shipped arm reproduces the already-pinned `record-runtime.test.ts` verdicts for specimens d/e
  exactly (harness-correctness floor before any OPA comparison), and the two dispatcher arms agree
  on all five specimens (violations AND event streams).
- requires-satisfied ⇒ no violation AND no suppress event, on both arms (observability at the
  dispatcher seam EXECUTED and confirmed: distinguishable from a `totem-ignore` suppression).
- Unreadable-file (`fileText: null`) ⇒ FIRES, and `fileText: ''` diverges on `''`-matching
  requirements (`^$`, `a*`) — both arms reproduce the measured null/empty split.
- Two consecutive `opa build` runs ⇒ byte-identical wasm hash.
- Expressibility census classes partition all 226 regex patterns (sum check, no silent drops).
- excludeGlobs uses the record profile — empty-positives ⇒ match-nothing is a HAND-CONSTRUCTED
  control (unreachable from a parsed record: `fileGlobs` is min-1 at parse).
- Specimen sources parse via `parseRuleRecord` AND compile via `compileRuleRecord` with zero
  deviations (the language⇄glob floor and engine-binding assert live in the LOWERING, not the
  parser — M1's lesson).

### Falsification fold (2026-08-27)

One falsification leg on the spike-local deltas; findings folded in four cause-clusters:
(A) differential units underspecified → § Differential units (M2 · P1 · P6);
(B) file-text model too thin → FactBundle `fileText: string|null` (M3 · P7 · N4's precondition);
(C) named-oracle ≠ pin-producing-oracle → § Oracle arms + strengthened parse→compile invariant
(P2 · P3); (D) specimen corrections → table amendments (M1 narrow (b) · swap (c) to `d0815b` for
matcher independence · P4 both-arms wording · N1 counts 48/47/1 · N8 YAML single-quoted/block
scalars for regex patterns). Confirmed intact: every hash/path/line-range in the table, freeze and
records-hash safety (attestation walks `.totem/rules/` only), the `loadCompiledRules` bypass
(records carry no `status`), fail-toward-flagging on both dispatchers, and specimen (a)'s
excludeGlobs re-authoring (executed, scope-probe parity with legacy). Branch-hygiene note: shipped
lint rules scope over `spikes/**`, so harness commits may carry ordinary advisory findings.

### Open questions

- **Q: Specimen sourcing** — author five NEW V1 records (semantics from named legacy rules + the two
  spec exemplars) vs lowering legacy compiled rules as-is. **Options:** records = tests the grammar
  the Spine actually compiles, uses the record glob profile honestly; legacy = zero authoring cost
  but the wrong glob profile (the census's hazard-1 silent widening). **Recommendation:** author
  records (table above).
- **Q: Toolchain channel** — pinned GitHub release binaries + sha256 in `toolchain.lock` vs
  winget/choco. **Recommendation:** pinned release binaries (exact-version pin is a PASS criterion).
- **Q: Artifact deposit** — ECL mail only vs mail + committed `spikes/spine-adopt/artifacts/` on the
  branch. **Recommendation:** both; the branch is the durable record and never merges without a
  separate operator word.

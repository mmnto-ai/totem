# Record→Rego lowering contract (spec § Spike 1; binds the lowerer and the OPA arm)

## Ownership boundary

Rego OWNS: scope predicate (fileGlobs/excludeGlobs, § Design 7 profile), per-line regex matching,
`requires:` two-pass semantics, suppression (marker substrings, both anchors), emission gating,
verdict/event assembly. Rego RECEIVES AS FACTS: ast-grep structural matches (`input.astMatches`,
AstGrepMatch shape) — tree matching stays engine-native; that boundary is itself a deposit finding.

## Input contract (= FactBundle, verbatim)

`input = { file, fileText: string|null, lines: [string], astMatches: [{lineNumber, lineText,
startLineText, startPrecedingLineText}] }`. Line `i` (1-based `lineNumber = i+1` off the 0-based
array) has `preceding = lines[i-1]` (absent for the first). All lines are additions with
`astContext` unclassified (spec § Differential units — disclosed simplification).

## Output contract (per record package)

- `violations` — SET of `{rule_id, line_number, ordinal}` where `ordinal` preserves multiplicity
  (regex: always 0, shipped emits ≤1 per line; ast-grep: the match index — shipped emits one per
  MATCH, two matches on one line = two violations).
- `events` — SET of `{kind: "trigger"|"suppress", line_number, ordinal}` mirroring the dispatcher
  event stream (requires-satisfied emits NEITHER — silence, not suppression).
- The comparator consumes both; `fired` derives from `violations` only.

## Lowering rules

1. **One package per record** — `totem.spike.r<ruleId>`; one wasm bundle per record
   (`opa build -t wasm -e totem/spike/r<ruleId>/result`), giving a per-record artifact hash for the
   chain `sha256(record yaml) → sha256(lowered .rego + fact schema) → sha256(bundle.wasm)`.
   `result = {violations, events}`. _(Ratified amendment: ruleId alone is not unique — the two
   exemplar transcriptions share the pinned id — so colliding ids take a `_<specimen>` package
   suffix; unique ids stay bare.)\_
2. **Strict is STRUCTURAL** _(amended after measurement — the original "run
   `--strict-builtin-errors` everywhere" is unsatisfiable: the flag is eval-only, `opa build`
   rejects it, and a wasm module has no equivalent — a policy with an uncompilable pattern builds
   (exit 0) and FAILS OPEN at eval: empty result, no trap. This wasm strictness gap is itself a
   deposit finding.)_ Cure: every emitted pattern is exercised by a `patterns_compile` probe inside
   the complete `result` rule, so a compile failure leaves `result` undefined, and the host raises
   an empty/undefined result as an ERROR row, never a no-violation verdict. `opa eval` runs (CLI
   arms, tests) still pass `--strict-builtin-errors`.
3. **Pattern emission is JSON-escaped double-quoted literals, never verbatim, never raw strings**
   (census hazards ii/iii): the lowerer emits `json.Marshal`-equivalent escaping (TS
   `JSON.stringify`), so `\b` survives as regex word-boundary (`"\\b"` in source) and the 17
   backtick patterns need no raw-string form.
4. **Regex engine gate:** only census classes `re2-clean` and `word-boundary` lower; a `lookaround`
   or `backreference` pattern is a REJECT row emitted by the lowerer (compile-loud, mirroring OPA's
   own behavior), never an approximation. (All five specimens lower; the reject path is exercised by
   the evidence-row patterns.)
5. **Globs lower to anchored regexes at lowering time** (TS side, § Design 7 profile: `**` crosses
   separators, `*`/`?` do not, case-sensitive, no negation — excludeGlobs is the structural
   exclusion). The glob→regex table is emitted beside the policy; its fidelity is asserted by
   scope-probe parity with `ruleAppliesToFile` on the specimen probe set (the shipped-verdicts
   harness already measures the shipped side).
6. **requires:** `scope: line` ⇒ requirement checked against the matched line text; `scope: file` ⇒
   against `input.fileText` when non-null; `fileText == null` ⇒ requirement UNMET ⇒ fire
   (fail-toward-flagging, explicit rule arm — never a default). `''` is a readable empty file and
   matches only `''`-matching requirements (the measured split).
7. **Suppression:** same-line `totem-ignore`/`totem-context:`/`shield-context:` substring, or
   preceding-line `totem-ignore-next-line`/`totem-context:`/`shield-context:` _(amended: the
   shipped `isSuppressed` accepts `shield-context:` on the preceding anchor too —
   `rule-engine.ts:349-356,384-388`; the contract was one marker short)_ — regex arm anchors on the
   matched line + its preceding; ast arm additionally on `startLineText`/`startPrecedingLineText`
   (dual anchor). Suppressed match ⇒ `suppress` event, no violation. **Order: `requires` is
   evaluated BEFORE suppression on all shipped dispatchers — a requires-satisfied match is silent
   even when marked (no suppress event).** Plain `totem-ignore` only in fixtures (the fail-soft
   attestation machinery is out of scope, spec § specimens note).
8. **Severity/message** are compile-time constants in the package (emitted for the report; not part
   of verdict comparison).

## Host contract (Rust arm)

`rust-opa-wasm` on wasmtime, crate versions pinned in the spike crate's committed `Cargo.lock`.
The host: loads each bundle, sets `input` = FactBundle JSON, evaluates the entrypoint, enforces
strict builtin-error surfacing, and enumerates EVERY import the wasm instance requires (the OPA ABI
census deliverable — any import beyond the documented OPA ABI set is a FAIL row per the ruled
criteria). Cold/warm evaluation times recorded per bundle. `regorus` runs the same lowered .rego +
input as a reference differential ONLY (a regorus-vs-OPA divergence is a finding about regorus,
adjudicated against `opa eval` as the reference semantics).

## Comparator

Per (record, fixture): shipped VerdictRow (from `artifacts/shipped-verdicts.json`) vs OPA-arm row vs
regorus row. PASS per the ruled criteria = identical violation multisets AND event streams on every
fixture; any divergence is classified explained/unexplained; unexplained ⇒ spike FAIL/park.

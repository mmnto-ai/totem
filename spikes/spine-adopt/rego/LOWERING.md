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
   `result = {violations, events}`.
2. **Strict always** (census hazard i): `opa build` and every `opa eval` run with
   `--strict-builtin-errors`; the host must surface builtin errors as errors. A silent `{}` on a bad
   pattern is the measured fail-open default and a spike-invalidating condition.
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
   preceding-line `totem-ignore-next-line`/`totem-context:` — regex arm anchors on the matched
   line + its preceding; ast arm additionally on `startLineText`/`startPrecedingLineText` (dual
   anchor). Suppressed match ⇒ `suppress` event, no violation. Plain `totem-ignore` only in
   fixtures (the fail-soft attestation machinery is out of scope, spec § specimens note).
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

### Problem Statement

The certification corpus assembly for authored rules (`buildAuthoredCertifyingCorpus`) must be strictly read-only against the authoring-ledger; it must fail loud and synchronously, before certification, if any current rule would be minted or revised during assembly (a cert run is NOT the first author). Additionally, under `producerKind:'authored'` the ground-truth label derivation must span the whole window (train + held-out non-control), per ADR-112 §6, so a train-slice false positive cannot escape the precision measure.

### Files (source-verified this session)

1. `packages/cli/src/commands/spine-authored-cert-corpus.ts` — `buildAuthoredCertifyingCorpus`; step 1 calls `runRuleAuthor` (the writer). This is where the no-mint gate binds.
2. `packages/cli/src/authored-rule-intake.ts` — `runRuleAuthor`: Pass 1 (PURE: eligibility/identity/contentHash → per-rule `action ∈ {minted,revised,unchanged}`), Pass 2 (IO: `appendAuthoringLedgerEntry` for `action !== 'unchanged'`). Already returns `{records, minted, revised, unchanged, rejected}`.
3. `packages/cli/src/commands/spine-derive-labels.ts` — `deriveLabelsFromDispositions` → the TP|FP answer key.
4. `packages/cli/src/commands/spine-fetch-dispositions.ts` — `corpusHeldOutPrs(split)` (held-out minus controls); the window-wide scope (§6) changes this under authored-primary.

---

## Implementation Design

### Scope (2 sentences)

**DECISION 2026-06-30 (operator): D2.5 ships P2 only; P1 splits to a follow-on D2.6.** P1 (window-wide answer-key derivation) proved materially larger than scoped — `assembleCertifyingCorpus` (the deriver's path) is mined-only (`llmReplaySha`-gated), so P1 requires a producerKind-aware deriver + skip-ground-truth authored assembly, a correctness-critical slice deserving its own design pass (the design doc's Q4 criterion: bundle only if the deriver change is small — it is not).

**D2.5 (this slice) = P2 only:** a **read-only / no-mint** gate so `buildAuthoredCertifyingCorpus` is side-effect-free against the authoring-ledger — it consumes only already-recorded, **unchanged** rules and fails loud (before certification, zero writes) if any current rule would be `minted`/`revised`. It will NOT add a second compiler, NOT touch the authoring path (`totem rule author` stays the writer), NOT score `authoredControls` (D3), and NOT re-decide the §8 identity/`judgedBy` single-source (D2-shipped).

**D2.6 (follow-on) = P1:** the §6 window-wide label scope — `fetch-dispositions` (window-wide non-control corpus PRs) + a producerKind-aware `derive-labels` (authored substrate, skip-ground-truth on first-derive) span the **whole window (train + held-out non-control)** under `producerKind:'authored'`. Contract-settled in §6/§5.3 (no new ruling owed); deferred only for size. The D2.5 NOTE at `spine-cert-run-corpus.ts:530` already marks the plug-in point.

### Data model deltas

- **`RuleAuthorOptions.verifyOnly?: boolean`** (new optional field on `runRuleAuthor`'s opts; default `false`).
  - _Holds:_ whether this call is a cert-run re-derive (read-only) vs. an authoring write.
  - _Writes:_ the caller — `buildAuthoredCertifyingCorpus` passes `true`; `totem rule author` omits it (`false`).
  - _Reads:_ `runRuleAuthor` Pass 2 — when `true`, **skips the `appendAuthoringLedgerEntry` IO entirely** and instead throws if any `pending[].action !== 'unchanged'`.
  - _Invariant:_ `verifyOnly:true` ⇒ **zero** ledger writes on every path (success or throw); guaranteed by gating Pass 2's append behind it and throwing _before_ the loop. Optional field, but the **cert producer must always set it** (the production-runnability precondition).
- **No new error class** — reuse `TotemError('GATE_INVALID', …)` matching the existing step-0/step-3 cert gates (the auto-spec's `TotemRuleMutationError` is rejected; the codebase uses `TotemError` codes, not branded subclasses).
- **No `windowLabels` field** — P1 changes the **derivation scope** (which PRs `corpusHeldOutPrs`/the firing enumeration cover), not a new field.
- **Possible P1 delta (open question):** a window-wide variant of `corpusHeldOutPrs(split)` — e.g. `corpusWindowPrs(split)` returning `(trainPrs ∪ heldOutPrs) − controls` — selected when `producerKind:'authored'`.

### State lifecycle

- `verifyOnly` is a **per-call** parameter (no container, no persistence). Created at each `runRuleAuthor` invocation, never mutated, never crosses a boundary. Ownership: the caller decides; `runRuleAuthor` only reads it. This deliberately avoids the "one-shot flag consumed before its work succeeded" hazard — there is no stored flag, and the throw precedes any IO.
- The authoring-ledger itself is **persistent** (`.totem/spine/authoring-ledger`), append-only, owned by `appendAuthoringLedgerEntry`. P2's guarantee is that the **cert path never mutates it** (Tenet-13 sensor-not-actuator).

### Failure modes

| Failure                                                                                 | Category | Agent-facing surface                                                                                           | Recovery                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Cert run, a current rule would be `minted` (no ledger entry for its identity)           | runtime  | hard error `GATE_INVALID`, names the rule(s) + `minted`                                                        | Run `totem rule author` to record the rule (with §3 judgedBy) **before** the cert run; a cert run is not the first author |
| Cert run, a current rule would be `revised` (YAML diverged from recorded `contentHash`) | runtime  | hard error `GATE_INVALID`, names the rule(s) + `revised`                                                       | Re-author to record the revision, or revert the YAML to the recorded form, then re-run cert                               |
| (existing, retained) empty ledger                                                       | runtime  | hard error `GATE_INVALID` (step 0)                                                                             | unchanged                                                                                                                 |
| (existing, retained) judgedBy divergence / split mismatch                               | runtime  | hard error `GATE_INVALID` (steps 0/3)                                                                          | unchanged                                                                                                                 |
| P1: a train-slice corpus firing has no disposition to label                             | runtime  | **must fail loud or be a deliberate `unlabeled` class** — NOT silent (else a train FP escapes precision, §5.3) | covered by the deriver's existing `unlabeledByReason` diagnostics; verify window-wide firings are dispositioned           |

No row is "silent degradation." The no-mint gate is **fail-loud-before-write**; the P1 label-scope explicitly closes the "train FP escapes" silent hole §6 names.

### Invariants to lock in via tests

- A cert-run re-derive (`verifyOnly:true`) over a ledger whose entries exactly match the current YAML returns the records and **appends zero rows** (read the ledger file byte-before == byte-after).
- A cert run where the YAML adds a **new** rule (would mint) throws `GATE_INVALID` naming that rule, **and the ledger is unmutated** (no partial append).
- A cert run where an existing rule's YAML changed (would revise) throws `GATE_INVALID` naming that rule, ledger unmutated.
- The **authoring** path (`verifyOnly` unset/false) still mints/revises exactly as today (no regression to `totem rule author`).
- P1: `deriveLabelsFromDispositions` produces a label for every **non-control** corpus firing across **both** slices under authored-primary (no train-slice firing silently unlabeled).

### Open questions

- **Q1 (contract, →strategy):** Is the no-mint gate a **`verifyOnly` mode on `runRuleAuthor`** (single source of the mint/revise decision — the sibling of D2's §8 source-flip, line 167), or a **separate producer pre-check**? _Recommendation:_ mode-on-`runRuleAuthor` — DRY, one source of truth for the action decision; a separate pre-check duplicates the contentHash/identity logic and creates a second source (a Tenet-20 mirror smell).
- **Q2 (contract, →strategy):** Is **`revised` forbidden identically to `minted`**? _Recommendation:_ yes — a revised rule means the YAML diverged from the recorded entry since authoring, i.e. the author is editing during the cert run, which the "a cert run is NOT the first author" invariant forbids exactly as minting does.
- **Q3 (contract, →strategy):** Frame the property as **side-effect-free against the authoring-ledger + assert-all-unchanged** (Tenet-13 + Tenet-4), composing with (not replacing) the existing step-0 empty-ledger and step-3 judgedBy/split gates — confirm no §8 separation conflict.
- **Q4 (build, mine):** flag name (`verifyOnly` vs `mode:'cert'`), and whether P1's window-wide selection lands this slice or splits to its own PR — leaning `verifyOnly` + bundling P1 if the deriver scope change is small.

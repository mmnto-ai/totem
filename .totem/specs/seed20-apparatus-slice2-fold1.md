# seed-20 apparatus slice 2 — falsification-leg fold 1 (diff `044e114b..5f273c73`, leg deposit 2026-08-29 ~21:05Z)

The standing pre-merge falsification leg (`doctrine/model-tiering.md` § Review legs) read the full diff against the design record, the pushed charter v1 (`origin/main`), and — its own disclosure — strategy's **local unpushed** scorer tree (`D:/Dev/totem-strategy` @ `9575044` + uncommitted `score.mjs`, carrying charter v1.1 § 7 E1–E22). Dispositions below are the owner's, verified at the cited lines. Every "adopted" item is implemented by the TS fold leg (file set `spikes/spine-adopt/src/**`) or by the owner (Go/Rust), then the runner re-runs the seam, regenerates the baseline, and re-arms the leg scoped to this fold. Constraints of `seed20-apparatus-slice2.md` stand unchanged; C5–C11 stand as amended here.

## Where the contract state is uncertain — the rule applied

The 19:23Z / 19:32Z / 19:57Z dispatches bind the names the record carries. The E-items the leg read from the unpushed tree add fields the mails did not name. Rule: **adopt every additive E-item** (a field the scorer may require and no one is harmed by), **fix every genuine error against the PUSHED charter**, and **disclose rather than guess** where the scorer's uncommitted preimage differs from an existing artifact convention. Two disclosures ride the PR-open mail (§ Disclosed).

## Adopted (with the defect verified)

- **F1 (B1, BLOCKING — a real error on the pushed charter).** `baseline-pins.mts policyRegoCodeText` stripped comment lines AND blank lines and appended `\n`; § 5 K3 (`preregistration.md:80`) defines `codeLines = emitted.split('\n').filter((l) => !l.trimStart().startsWith('#'))`, joined by `\n`, no blank-line filter, no trailing newline — the apparatus's own join at `lower.mts` (`:858` at HEAD). Measured on the capture: charter formula `0f8223c74c1cc5560cfbfcb7c86590490eef3f6e269677c136ca0bcc0ce08e7b`; the shipped extractor `9190876a…`. My record's § S2 ("minus blank lines") was the source. **Fix:** the charter formula, verbatim; `baseline-pins.mts` pins `0f8223c7…` as the capture's code digest; `manifest.mts` asserts the recomputed digest equals it.
- **F2 (B2).** `k3Capture.repinned: boolean` — `false` when the apparatus's recomputed `policyRegoSha256` / `policyRegoCodeSha256` / `chainSha256` all equal the pinned capture's (the pinned target stands), `true` otherwise with `repinnedDigests{…}` beside. Additive.
- **F3 (B3).** `probeGeneration.frozen: [...SPECIMEN_PROBE_PATHS]` (22, authored order — the scorer cannot derive an apparatus constant). Additive.
- **F4 (B4 — ruled 19:23Z, dropped by my record).** `sharedProbePaths('seed20')` = the frozen 22 + every seed record's `inlineFilePath` + every `fixture.file` + the generated probes and twins; deduped; codepoint-sorted. `manifest.probePaths[]` is published SORTED on every set (N3 — the digest attests the published order); `probePathsSha256` = sha256 of the sorted list `\n`-joined **with a trailing `\n`** (the `tracked-paths.txt` file-bytes convention — § Disclosed 1). `sharedProbePaths('specimens')` stays exactly the 22 (a chain-digest input).
- **F5 (B5).** `controlRecords[]` rows = `{ file, sha256, control: true, seedEntry: null, ruleId, package, role, bundleFixtureIds: [...] }` — the enumeration is DECLARED at manifest time from the record (`${id}-inline[-i]-bad|good` per `facts.mts`'s naming for each `examples[]` pair, plus `${id}-control-unreadable` and `${id}-control-empty`), and `facts.mts` asserts after minting that the bundles whose `specimen` is the control's id equal that enumeration (a FAIL check otherwise).
- **F6 (B7 — emitted beside, not instead).** `t5-sweep.json.header` gains `argv: [...]` (the invocation as an argv array with the holes) and `policies: { [pkg]: { policyRegoSha256, wrapperSha256, recordId, seedEntry, control } }`, keeping `invocation` + `packages[]` the 19:57Z mail accepted. Additive; § Disclosed 2.
- **F7 (B8).** Control packages (`lowered[].control === true`) are not swept into `rows[]`/`probeRows[]` — T5 is a per-record conjunct over SCORED records; the K5 control is exercised by K5. `header.controlPackagesSkipped: [pkg…]`; the one-entry-per-package check counts non-control packages.
- **F8 (B9).** No timing inside `rows[]`/`probeRows[]` (they must be byte-identical between the scorer's evidence and replay clones); `timings: { totalMs, perPackage: { [pkg]: { rowsMs, probeRowsMs } } }` at top level.
- **F9 (M1).** `lower.mts`'s per-glob parity (`globDrift`) and two-array parity (`scopeDrift`) become DISCLOSING check rows (always true; detail = count + the first drifts; the full lists already live in `globs.json`) on every set — a lowered-vs-shipped disagreement on a probe is a T5 `scope-divergence`, the scorer's to type (charter § 5 K3b: "a disagreement is a T5 scope-divergence, not a K3b fault"). The K3b `blind` check (a reachable glob without ≥1 matching and ≥1 non-matching probe) stays REFUSING.
- **F10 (M2).** K6 pins the SEVEN emitter symbols § 5 K3 names — `emitPolicy`, `SAME_LINE_MARKERS`, `PRECEDING_LINE_MARKERS`, `globToRegexSource`, `packageSuffix`, `q`, `regoStringArray` — each extracted by symbol (its declaration to its terminator) from `src/lower.mts`, expected digests computed from the `6ca24d42` blob with the same extractor. Rows are DISCLOSING: `eq: false` refuses UNLESS the symbol is on `EXPECTED_DELTAS` in `baseline-pins.mts` with its benignity string — the one known delta: `packageSuffix`'s parameter rename `specimenId` → `discriminator` (mmnto-ai/totem#2694 G1), emitted bytes unchanged (proven by the seven committed chains reproducing) → `{ eq: false, disclosed: '<reason>' }`; the header prints every disclosed delta.
- **F11 (M3).** `controls.mts` K5b reads `wazero-report.json` only when its `recordSet` equals the run's (the Go arm now writes `recordSet` — owner's change); otherwise `ok: null` naming the stale report.
- **F12 (M5).** `compare.mts` pairs carry `explanationClass: null` present on every MATCH row (present-as-null on both comparators); the specimens `differential-report.json` gains 72 `explanationClass: null` — on the allowance.
- **F13 (M6).** `manifest.mts`: on `seed20` and `control`, `workingTreeClean === false` is a FAIL check unless `SPIKE_ALLOW_DIRTY_TREE=1` is set (dev runs set it; the run of record does not; the header prints which); recorded-not-gated on `specimens`.
- **F14 (M7).** `lowered[].published` derived from `LOWERED_PUBLISH_DIR` relative to `SPIKE_ROOT` (true under a subdir).
- **F15 (N2).** `K3_EXPECTED_IDENTICAL` spells `regoComposition.components.factSchemaLine` unbracketed (`leafPaths` brackets only keys containing `.`).
- **F16 (N5).** K8's `namesTheField` is a whole-token match (`(^|[^A-Za-z0-9_.])<name>([^A-Za-z0-9_]|$)`), never a substring.
- **F17.** The T5 SKIPPED arm mirrors the new header/timings keys.
- **G1 (M3, owner).** `wazero-probe/report.go` writes `recordSet` into `wazero-report.json`.
- **G2 (M8, owner).** Go and Rust apply the same `k3-control` default subdir when `SPIKE_CONTROL_RECORD` is set and `SPIKE_ARTIFACTS_SUBDIR` is not; Go stops `TrimSpace`-ing the value (all three arms reject a value with whitespace).
- **G3 (N1, owner).** Go refuses `SPIKE_RECORD_SET=control` without `SPIKE_CONTROL_RECORD` (TS already does); `probe_test.go` re-pinned.
- **G4 (N6, owner).** The Go run-start block prints `workingTreeClean`.

## Already folded before the deposit landed

- **M4** — § S6 of the record was amended in `0783271f` (rows/probeRows; deposited, never refused) after the leg's read at `5f273c73`.

## Disclosed (carried to the PR-open mail; no code change)

1. **B6 — the sorted-list digest preimage.** The apparatus hashes the list `\n`-joined WITH a trailing `\n` — the bytes of the published list file (`sha256sum artifacts/tracked-paths-at-record-pin.txt` reproduces it), the same convention `trackedPaths.sha256` (T17, slice 1) already uses and the scorer already hashes as file bytes. The scorer's uncommitted `probePathsSha256`/`treeSha` preimage omits the newline; the seam needs one rule — the apparatus keeps the file-bytes rule and says so.
2. **B7** — header emitted in both spellings (F6).

## Not adopted (with grounds)

- None declined outright. **N4** (the record's byte-delta enumeration incomplete) is the owner's record edit at the final regeneration.

## Verification the runner performs after the fold (not the legs)

The full seam script (specimens check → seed20 with the Go arm → control-only → K4 under `k4-swap/` → restore → FINAL specimens regeneration), every stage's exit captured; the seed20 numbers re-stated (23 rows; 33/33 pairs; T5 rows/probeRows over the SCORED packages only, 0 disagreements; K3 arm A/B; K4; `k3Capture.policyRegoCodeSha256 === 0f8223c7…`, `repinned: false`; `byteIdentity` 7 lower.mts symbols + 4 files with exactly one disclosed delta); the baseline delta re-classified; then the falsification leg re-armed scoped to `5f273c73..HEAD`.

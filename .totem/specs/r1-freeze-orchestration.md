# R1 — the tamper-evident freeze-orchestration (ADR-112 §5.1/§5.4/§8, real-set slice 1)

**Contract:** strategy 0102Z Q1/Q2/Q3 (Option A ratified by the operator in-session — mechanism-first, full scope). Tracker totem#2291 (item-1 recorded).
**Panel:** codex CONCERN-foldable (5 folds, all folded below) · agy CLEAN (+t7/t8, seams RULED: real-git fixtures) · gemini CLEAN (axis-1 D5-as-built reading superseded by codex fold-5 — recorded here, not a conflict).
**Constraints:** #2289 must-not-widen (no gate consults the optional doctrine pin; suite passes on a stock disconnected machine — agy verified framing) · mined + D5-authored fixture paths byte-unchanged where the frozen-artifact seam doesn't bind · fixture-proven end-to-end (D-ladder standard).

## The three claims (Tenet-19 legibility — name them so no field oversells)

1. **Mechanism-class (this slice ships it):** no effective authoring-ledger entry precedes the freeze artifact in SHARED history, and the freeze cannot be re-stamped without orphaning every downstream entry.
2. **Adherence-class (stays; sandbox narrows, attestation records):** pre-freeze working-tree drafts are invisible to git — the (c) non-inspection attestation remains the recorded backstop.
3. **NOT claimed:** trustworthy wall-clock instants. Topology is the proof; timestamps are consistency checks (codex fold-1).

## New artifact — the frozen split (`.totem/spine/<gate>/frozen-split.json`, TRACKED-PUBLIC home)

`packages/core/src/spine/frozen-split.ts` — `FrozenSplitArtifactSchema`:

- Derivation pins (Tenet 20 — derive from primitives, pin the result): `repo`, `asOfCommit` (the ACTUAL lc HEAD SHA at freeze — derived, not declared), the selectionRule snapshot used, `excludedPrs`.
- The split: `corpus` (PR list), `trainPrs`/`heldOutPrs` (cutIndex under the held-out ≥ 0.5 inclusive floor — freeze-side gate, hoisting D5's Q2 check), `cutBoundarySha` (the last train PR's mergeCommit — the §5.4 sandbox root derives from THIS, fold-sandbox below).
- `frozenAt`: full-ISO instant stamped AT freeze (the one legitimate clock — the freeze IS the event).
- `corpusIntegrity`: sha256 over the canonical enumeration result.
- **`splitRef` = `split:<sha256(canonical split payload)>`** — content address over the canonical artifact payload EXCLUDING the commitment field (codex fold-3: commitment ≠ ref, no circularity). Human label optional, separate field, never load-bearing.
- **`freezeCommitment` = `sha256(splitRef · frozenAt · corpusIntegrity)`** (canonical tuple).

## `totem spine freeze-split` (`packages/cli/src/commands/spine-freeze-split.ts`)

Enumerates off the lc clone (reuse `enumeratePrMetas`/`resolvePrGit`), derives asOfCommit = actual HEAD, resolves the split (reuse `resolveSplit` + cover guards), runs the freeze-side floor gate, stamps `frozenAt`, computes splitRef + commitment, writes the artifact to the tracked home. Writes NOTHING on any gate failure. It does NOT commit — **the freeze PR's operator-named merge is the human gate (Q3)**; the artifact becomes valid-for-authoring only once in `origin/main` ancestry (binding enforces).

## Shared-history proof (codex fold-1 — topology IS the proof)

CLI-side git plumbing (new `packages/cli/src/spine-freeze-proof.ts`), consumed by the binding + materialize:

- `findIntroducingCommit(path)` — from `origin/main` (or configured shared default ref), NEVER HEAD/local refs.
- Blob equality: current artifact bytes == blob at the shared introducing commit.
- Ledger ordering: every effective entry's introducing commit **strictly later by ancestry** than the freeze artifact's — ancestry, not timestamps.
- `frozenAt ≤ committerDate(introducingCommit)` = consistency check ONLY (distinct diagnostic, t8's clock-skew row gets its own message).

## `totem rule author` binding (`authored-rule-intake.ts`)

`authored-rules.yaml` header: declared `splitRef` + `freezeCommitment` (both now verifiable). The intake resolves + verifies BEFORE any ledger append. **11-row non-aliasing failure partition** (codex fold-4): artifact absent · present-but-uncommitted · tracked-locally-but-absent-from-origin/main-ancestry (≠ uncommitted — only this one fools a HEAD-ancestor proof) · blob-differs-from-shared-introducing-commit · splitRef resolves zero artifacts · resolves >1 · commitment mismatch · frozenAt/authoredAt malformed or non-full-ISO on certifiable rows · artifact path outside the tracked freeze home · ledger entry not in shared history / dirty · entry introduced same-commit-as-or-before the freeze.
**Ledger + chain (codex fold-2):** every `AuthoringLedgerEntry` gains `freezeCommitment`; `authoringContentHash` material EXTENDED to include it (inside, not adjacent) — a re-freeze flips every downstream entry to would-revise, never "unchanged". That is the orphaning property, riding the existing idempotency seam.

## §5.4 sandbox (IN R1; independence axiom applies to config — codex sandbox note)

Sandbox root = an lc worktree at `cutBoundarySha`, **derived from the frozen artifact** — the author command accepts NO root/allowlist knobs. The intake's matcher dry-run (`evaluateStructuralEligibility` exemplar evaluation) reads ONLY: the frozen artifact's train-side diffs + the sandbox tree. Any read outside → fail-loud (t6).

## Materialize evolution (codex fold-5; supersedes gemini's axis-1 D5-as-built reading)

- Authored seed **names** the frozen artifact: `split.frozenSplitRef` (additive). `seed.split.frozenAt` stops being authoritative for authored runs; the #2288 parse-time presence guard EVOLVES: `producerKind:'authored'` ⇒ `frozenSplitRef` present (keep the frozenAt clause for legacy-shaped seeds → superRefine update, mined byte-unaffected). [Couple flag: §8 superRefine currency touch — strategy acked.]
- `materializeAuthored`: load the frozen artifact by ref → verify shared-history proof + commitment → re-derive the split from the pinned inputs **as an assertion only** (canonical-byte compare; differ ⇒ fail-loud, write nothing) → output split.json = **byte-identical copy** of the frozen artifact. Detect-never-repair everywhere.

## Test matrix (agy-approved + additions; seams RULED: programmatic real-git fixtures — `git init`/`commit` in temp dirs, no injected git mocks for the proof gates)

Happy path end-to-end: freeze-split on fixture corpus → artifact committed in fixture repo (+ simulated origin/main share) → `rule author` accepts → materialize loads/asserts → run → authored verdict. Tamper: t1 re-stamp orphans (would-revise via contentHash) · t2 frozenAt postdates introducing commit (consistency row) · t3 entry not-strictly-later by ancestry · t4 absent/unfrozen splitRef refused · t5 uncommitted artifact refused (distinct from tracked-local-not-shared) · t6 sandbox held-out read denied · t7 post-freeze content injection under the split home → hash-drift fail (agy) · t8 clock-skew → distinct temporal-regression message (agy). Regression: mined byte-identical snapshot · D5-authored fixture path unchanged where unbound · #2289 row (no doctrine-pin consult; grep-provable + suite green disconnected). Windows note: CRLF-vs-LF in real-git fixtures (agy called it — normalize like `generateInputHash` does).

## Carries

Changeset `@mmnto/totem` + `@mmnto/cli` (minor — new command + schema). Couple flags to strategy on PR: proof-by-topology mechanization wording · seed-contract evolution · sandbox-root derivation. #697 window row logs at couple/merge. Lint note: commit-then-lint (untracked-file false-green, #2287 rung).

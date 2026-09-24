# Gate (5) migration — batch 3 translation notes

Pre-registration: `operations/310-migration-preregistration.md` **v1.3** at mmnto-ai/totem-strategy
`729fa215` (mmnto-ai/totem-strategy#1424; v1 at `b9ed654d`, v1.1 at `6fee96b5`; the governing text
on any difference with these notes). Charter: strategy-claude's dispatch of 2026-09-23T18:48:51Z (the
record on mmnto-ai/totem-strategy#288); batch 3 on the standing greenlight per the scorer's receipt
of 2026-09-24T00:13:54Z § 4. Freeze: `operations/310-migration/inputs/manifest.json` at strategy
main `46901a04`, sha256 `2263305cfbbe8b792d8884d8091a311676ba8ddedf75e852fa9ab434de950ca5`, 53
rules; the run's `splitRef` suffix is `gate5-migration-2263305c`.

**Batch 3 = manifest `rules[]` positions 27–39 (ranks 146–174): 13 rules, 13 records** (no N-record
set: the two ast-grep rows are single-language). Translator: totem-claude. The curator IS the
translator seat on two rows of this batch (`83b86cd7`, `87e24374` — totem-claude's 2026-08-24
curation), disclosed as § 1 discloses it (temporal separation only). This batch carries: two
inventory (ii) declarations (`64bb807f`, the pre-registration's K8b shape; `5da43ea6`, the R14 seed
entry 13 re-pin with R14's own `requires:` translation kept); one lookahead kept VERBATIM as an
inert construct (`83b86cd7`, proved below); the manifest's one lone compiled `bad` (`fe1b4123`,
recorded here, never a pair); three timestamp headings (`391de708`, `64bb807f`, `5da43ea6`).

**Stacking, disclosed:** the branch `gate5/batch-3-2263305c` is off the batch-2 pin `ef21defc`
(mmnto-ai/totem#2947), itself off the batch-1 pin `49754e9c` (mmnto-ai/totem#2945), because the
harness, the frozen manifest copy, the K3 expectations file and the `.prettierignore` line live only
on that stack until it merges; batches 1 and 2's records and envelope entries are present here
unchanged. The batch-3 draft PR targets the batch-2 branch and re-targets when that branch merges.
The manifest-only refresh (D2) runs at this pin too (`records_hash` re-attested over the 42 tracked
records, `compiled_at` restamped, nothing else), because the pre-push compile-manifest arm requires
it. **The four foreseeable merges and the sequencing rule** are the batch-2 notes' (their stacking
paragraph, folded from that pin's leg): the `compile-manifest.json` restamp conflicts by
construction; the shared envelope is not append-only past an earlier batch's intake pin (§ 3.3
keeps review-rejected entries out at intake time); `judgedBy` sits inside the ledger row's
`authoringContentHash`, so a later batch's intake over carried entries under a different set id
would read them `revised`; after a squash the base pin is not an ancestor of `main`. So batch 3's
intake step runs only after the batches below it merge and `main` is brought in by MERGE (never a
rebase; no raw ref-delete of a base branch), the envelope reconciled to the post-intake entries below
(the generator's `--exclude`), the ledger rows carried forward, the manifest-only refresh last.

**What the scorer's batch-1 review changed for this batch (its receipt of 2026-09-24T00:13Z, verified
at strategy `729fa215`):** engine typing (whitelist rule 2) is MEASURED — the frozen regex per line
over the pinned tree's in-scope files, every firing classified by the shipped `classifyLines`; a
`comment`-context firing is the token appearing in a doc-comment and fails the class as the header's
sentence reads. So these notes carry that measurement per regex rule up front (`census-batch-3.txt`,
the scorer's own instrument `class-review/census-comment-firings.mjs` at `729fa215`, run by the
translator over this batch's eleven regex rules with the same staging install and tree; counts
below). And the operator's word of 2026-09-24 (relayed 00:18Z) on the exemplar row: **(A)** — a
rule whose honest class is `regex/forbidden-literal-token` is NOT `intake-ineligible`; its admission
is measured at the intake pin like any record's and flagged on R6; (C), a scope clause in the
header, is held for the report.

## Method

- **Source of truth per rule:** the manifest row — `legacy.{severity, message, pattern | astGrepPattern |
astGrepYamlRule, fileGlobs}` for the matcher and its scope, `curatedPair` for pair 0, `curator` /
  `curatedAt` / `lessonHash` for the curation block, `targetDefectText` for the envelope. Every such
  value was COPIED out of the frozen manifest copy (sha256-checked by the generator before any read)
  by a generator (the translator's scratch tool, not part of the pin) and round-trip-checked against
  it FROM THE WRITTEN FILE; nothing was retyped. The generalized harness's fidelity leg re-verifies
  the copy with the real parser on the eleven identical records (11/13 identical + 2 declared (ii)
  divergences + 0 unexpected, below); **on the two (ii) rows it checks only that a `requires:` block
  is present and excuses the payload delta** (the pin's harness, unchanged), so their record pattern
  and `requires.pattern` are checked by the generator's assertion (not on the branch), by the diff
  against R14's record for `5da43ea6` (parse-identical, below), and by the falsification leg over
  this pin; the per-rule notes quote both sides for the scorer's C3 read.
- **Record contract applied (§ 4 item 5):** `curation.sourceLesson: lesson-<lessonHash16>` ·
  `curatedBy` = the row's curator · `curatedAt` = the row's `curatedAt` (quoted, a string) ·
  `baseline5Phase: 3`; `severity` and `message` byte-for-byte; `examples[0]` = the curated pair after
  `lf`; no complete legacy compiled pair exists on any row of this batch, so `examples` has exactly
  one pair on every record; the one lone compiled `bad` (`fe1b4123`) is recorded in its per-rule
  note, as § 4 item 5 says, and never appended.
- **Closed transformation inventory (§ 3.1 C5), declared per rule below and machine-readably in
  `mig-inventory.json`:** (i) `!`-negated legacy globs → `excludeGlobs`; (ii) a must-contain
  lookaround → `requires:` (the `line` window) — two declared, applied mechanically as batch 2 applied
  it (the lookahead removed from the pattern as ONE exact substring, asserted present exactly once;
  its body, less the window prefix it carried, the `requires.pattern` with `scope: line`; nothing
  else in the pattern moves): `64bb807f` `(?!\s*&&)` → `requires: '\s*&&'`; `5da43ea6`
  `(?!.*\s--\s)` → `requires: '\s--\s'` (R14's translation, reproduced by the same mechanics); (iii)
  none — `fe1b4123` and `6f362fa2` carry `.ts`-only globs.
- **The (ii) choice and its ground (§ 7 (b); the batch-2 notes' wording stands):** declaring (ii) is
  the translator's choice — the shipped regex gate accepts a lookahead — and its ground is C3's
  conjunct, "no opaque escape or regex hack standing in for a first-class construct", read with § 2
  item 8's "the only V1 window for a target-adjacent requirement is `line`"; the cost, the widening,
  is measured by the firing-set leg, and C3's mechanical rule reads the declaration by its delta (no
  added firing = right; removed-only = PASS with the `window-widened` covariate). **Measured: added 0
  on both; removed 7 on `64bb807f` — every legacy firing on this tree — and 0 on `5da43ea6`.** The
  `64bb807f` case is examined in full in its per-rule note: all seven removed lines carry a null
  guard BEFORE the `typeof` (the legacy lookahead looks only after it), so the seven are legacy
  false positives under the lesson's own intent, and a target-anchored requirement variant
  (evidence only, not the record) reproduces the legacy 7/7 — the shape of the
  mmnto-ai/totem-strategy#1093 demand row.
- **An inert lookaround, kept verbatim (§ 2 item 8: "an inert lookaround is admitted"):** `83b86cd7`'s
  `(?!\?)` sits where `\s*:` must match next, and `?` is neither whitespace nor `:`, so every
  position the lookahead rejects is one the rest of the pattern rejects — the lookahead can change
  no verdict. Proved, not asserted: `inert-83b86cd7.mjs` (beside these notes, with its log) compares
  the legacy pattern and the pattern with the lookahead removed over a 12-line battery and over
  every in-scope line of the pinned tree (380 files, 117,505 lines, 11 legacy firings): **0
  disagreements**. No transformation is declared (the record's pattern is the legacy's, byte for
  byte; fidelity: identical); the scorer's C3 read admits the construct as inert or rules otherwise.
- **Language split rule (§ 7 (b)):** not exercised — both ast-grep rows name `.ts` globs only. Regex
  rules carry every legacy glob verbatim (no language floor on regex): `**/*.py`, `**/*.go`,
  `**/*.rs` on `87e24374`, `**/*.env` on `56c801df`, `**/*.tsx`/`**/*.jsx` on four rows, `**/*.bash`
  on three — zero-file globs kept.
- **Grammar authority:** the shipped parser and lowering of `@mmnto/totem` 2.10.0 (the translation
  pin's version, § 7 (a)), the staging install of the PUBLISHED package this session made for batch 2
  (`@mmnto/cli` 2.10.0, `@mmnto/totem` 2.10.0, `@ast-grep/napi` 0.42.3, node v24.16.0) — never a
  workspace build; the harness's `--core` points at `<staging>/node_modules/@mmnto/totem`.
- **Harness:** `operations-local/gate5/mig-harness.mjs` **reused byte-for-byte at the batch-1 pin
  `49754e9c`** (charter § 5 step 3); no harness change in this batch. Per-record output at
  `operations-local/gate5/batch-3/harness-per-record.jsonl` (schema `gate5-harness-record/1`, 13
  lines); the run log verbatim at `operations-local/gate5/batch-3/harness-run.log`; the K3
  self-check re-run from this worktree at `operations-local/gate5/batch-3/k3-run.log` and
  `k3-per-record.jsonl`, against `operations-local/gate5/k3/k3-r14-inventory.json`.
- **Honest structural classes (§ 3.4):** named per rule BELOW, before any intake ran; not revised
  after a refusal. Disclosed: the translator built the intake and knows the five whitelist rows. The
  names are defect-SHAPE names at the granularity a decidability review can act on, shared with
  batches 1 and 2 where the shape is theirs. **Carry-over, read against the scorer's receipt (pairs,
  not names; the batch-1 table at `729fa215`):** `(ast-grep, type-assertion-on-call)` DELIVERS —
  `6f362fa2` carries over as deliverable; `(regex, forbidden-callee-literal-arg)` and
  `(regex, forbidden-path-literal)` were WITHHELD on measured engine typing — `434c51ff` and `0615c43e`
  carry over as `intake-ineligible (engine-typing)`, kept out of the envelope at the intake pin,
  whatever their own census counts read (the pair is withheld, and the pair is the whitelist's key);
  `(regex, forbidden-literal-token)` is the exemplar row — four rules of this batch name it honestly
  (`391de708`, `87e24374`, `55797450`, `56c801df`: each a fixed literal token), mint at the pre-pin
  pass, and read under the operator's (A): admission measured at the intake pin, flagged on R6;
  `forbidden-callee-literal-arg` under ast-grep (`fe1b4123`) is a NEW pair. The census count per
  regex rule is stated in each note for the review's rule 2.
- **The whitelist header vs the shipped predicate** (the batch-2 notes' disclosure, still owed to the
  class review and the delivery PR): the header calls a class under two engines AMBIGUOUS while the
  predicate filters on both engine and class, and the eligibility `basis` string carries no engine.

## Whole-batch transformation inventory

| Transformation                                                  | Count | Rules                                                                                                                                    |
| --------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| (i) `!`-negation entries → `excludeGlobs`                       | 5     | `83b86cd7`, `cf65e2b4`, `64bb807f`, `fe1b4123`, `6f362fa2`                                                                               |
| (ii) must-contain lookaround → `requires:` (`line` window)      | 2     | `64bb807f` (removed 7, all legacy false positives; the K8b shape), `5da43ea6` (removed 0; R14's translation reproduced); added 0 on both |
| Inert lookaround kept verbatim (no transformation; § 2 item 8)  | 1     | `83b86cd7` — proved over the battery and the tree, 0 disagreements                                                                       |
| (iii) N-record language split                                   | 0     | — (both ast-grep rows are `.ts`-only)                                                                                                    |
| Legacy compiled pair appended as `examples[1]`                  | 0     | — (`fe1b4123` carries a lone compiled `bad`, recorded in its note)                                                                       |
| Brace-glob expansion · shallow-glob promotion · `message` edits | 0     | —                                                                                                                                        |
| `lessonHeading` dropped                                         | 13    | the V1 grammar has no heading construct; the heading rides the envelope's `targetDefect`                                                 |
| Legacy `manual` / `unverified` flags dropped                    | 7     | `391de708`, `83b86cd7`, `64bb807f`, `87e24374`, `434c51ff`, `0615c43e`, and no other row carries them; the grammar has no such field     |

## Harness results (verbatim summary lines; full logs on the branch)

Batch 3 (`harness-run.log`, exit 0):

```
Validate: 13 record(s) — parsed 13, compiled 13, lowering-rejected 0, harness failures 0; expectation mismatches 0
Fidelity (records): 11/13 identical, 2 expected divergence(s), 0 UNEXPECTED
Fidelity (entries): 11/13 identical, 2 expected divergence(s), 0 UNEXPECTED
Differential split (measured, per entry):
  differential-satisfied   13  (entries 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39)
  good-also-fires          0
  bad-does-not-fire        0
  not-evaluable            0
Differential expectation mismatches: 0
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

The two expected divergences are the two (ii) rows. Legacy-row-over-pair-0: `bad=FIRES good=silent` on
all 13 rules — the frozen matcher discriminates its own curated pair on every row. Firing-set leg
over the pinned tree: `added = 0` on every entry; `removed = 0` on twelve entries and `removed = 7`
on `64bb807f` (the seven lines quoted in its note). The entry numbers in the log are manifest
positions (27–39); the log notes the 29 record files of batches 1 and 2 as ignored (the stacking).

K3 self-check (`k3-run.log`, exit 0) over the 22 R14 records at `78e7f196` under the same 2.10.0
staging core, `--seed seed-20.json --corpus compiled-rules.json --r14` (both inputs at the manifest's
blob ids), from this worktree: the same figures as the batch-1 and batch-2 runs (validate 22 · 21 · 1
· 0; differential 15 · 3 · 1 · 1 with the P0 entry sets; probe 0/7, controls 1/1; fidelity 18/20 +
2 declared + 0 unexpected; REPRODUCED), and **`k3-per-record.jsonl` byte-identical to the batch-1
pin's `operations-local/gate5/k3/k3-per-record.jsonl`** (`cmp` exit 0).

## The engine-typing census (the scorer's instrument, run by the translator)

`census-batch-3.txt` beside these notes: `class-review/census-comment-firings.mjs` at strategy
`729fa215` (exported from that commit, unmodified), `--tree` the pinned tree `5293614b`, `--manifest`
the frozen manifest, `--staging` the 2.10.0 install, `--rules` the eleven regex rules of this batch.
It counts RAW per-line legacy firings by the shipped AST-context classifier, before the runtime's
suppression (its own header says so). Per rule, `code · comment · string · other (no-grammar/regex)`:

| Rule       | code | comment | string | other         | total | comment-context firings, sample                                                                             |
| ---------- | ---- | ------- | ------ | ------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `391de708` | 3    | **1**   | 3      | 1 no-grammar  | 8     | `packages/core/src/sys/git.test.ts:151` (a comment quoting `origin/main...HEAD`)                            |
| `83b86cd7` | 10   | **1**   | 0      | —             | 11    | `packages/core/src/config-schema.ts:562` (a JSDoc line carrying `mcpServers:` inside an example)            |
| `cf65e2b4` | 6    | 0       | 0      | —             | 6     | —                                                                                                           |
| `64bb807f` | 6    | 0       | 1      | —             | 7     | —                                                                                                           |
| `87e24374` | 1    | **2**   | 34     | —             | 37    | `packages/core/src/compiler.test.ts:267`, `packages/core/src/diff-parser.ts:27` (comments quoting `+++ b/`) |
| `434c51ff` | 2    | 0       | 0      | —             | 2     | —                                                                                                           |
| `55797450` | 1    | 0       | 1      | 3 no-grammar  | 5     | —                                                                                                           |
| `0615c43e` | 7    | 0       | 2      | —             | 9     | —                                                                                                           |
| `56c801df` | 3    | 0       | 0      | 15 no-grammar | 18    | —                                                                                                           |
| `4ac94d6f` | 2    | 0       | 0      | 1 regex       | 3     | —                                                                                                           |
| `5da43ea6` | 0    | 0       | 1      | —             | 1     | —                                                                                                           |

So at this tree three regex rules of this batch carry a comment-context firing (`391de708`,
`83b86cd7`, `87e24374`) and eight carry none; the review applies the rule, these notes only measure
it. `no-grammar` counts the in-scope `.sh` / `.yml` / `.json` / `.env` files the classifier has no
grammar for (counted, never skipped — the instrument's rule); `5da43ea6`'s one firing is a string.

## Per-rule notes (manifest order)

Fields: legacy construct → record construct · inventory · honest class (engine) · census · pinned-tree
firing set (legacy → record) · notes.

### 27. `391de7088c633579` — rank 146 — regex — `mig-391de708-hardcoded-main-head-range.rule.yaml`

- Legacy: `pattern: \b(main|master)\.\.\.HEAD\b`; globs `**/*.ts`, `**/*.js`, `**/*.sh`; warning;
  `manual`, `unverified`; **the `lessonHeading` and the `message` are both the timestamp
  `2026-03-03T01:52:20.000Z`** (`headingIsTimestamp: true`; a pre-registered `defective-source`
  candidate; the record's `message` and the envelope identity carry the timestamp byte-for-byte).
  Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed literal token (`main...HEAD` /
  `master...HEAD`, word-bounded) in source files; the exemplar row's shape, on a SOURCE scope; mints
  at the pre-pin pass; under the operator's (A) its admission is measured at the intake pin and
  flagged on R6. Census: 1 comment-context firing (a test comment quoting the range).
- Firing set: 8 → 8, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 28. `83b86cd73d637a6c` — rank 154 — regex — `mig-83b86cd7-mcp-fields-optional.rule.yaml`

- Legacy: `pattern: \bmcp[a-zA-Z0-9_]*(?!\?)\s*:`; globs `**/*.ts`, `**/*.tsx`, `!**/*.test.ts`;
  warning; `manual`, `unverified`. Record: pattern VERBATIM (the lookahead kept), `fileGlobs` the two
  positives, `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i). **The lookahead is inert and is kept** (no (ii)): after `mcp[a-zA-Z0-9_]*` the
  pattern needs `\s*:`, which can never match where `?` follows, so `(?!\?)` rejects only positions
  the rest already rejects; backtracking into the identifier cannot help because the identifier
  class contains neither whitespace nor `:`. Proved by `inert-83b86cd7.mjs` (its log beside these
  notes): the battery of 12 shapes (required / optional / spaced / ternary forms) and every in-scope
  line of the pinned tree (380 files, 117,505 lines, 11 legacy firings) — 0 disagreements between
  the legacy pattern and the pattern without the lookahead. Fidelity: identical. C3 admits an inert
  construct (§ 2 item 8); the scorer's read decides.
- Honest class: `property-key-missing-optional-marker` (regex) — a property signature whose key
  carries a fixed prefix (`mcp…`) and lacks the optional marker. New for the review. Census: 1
  comment-context firing (a JSDoc example naming `mcpServers:`); 10 code-context firings, most of
  them `mcpPath:` / `mcpJsonPath:` keys in object literals (not type members) — curation feedback
  for R8: the matcher does not distinguish an object-literal key from an interface member.
- Firing set: 11 → 11, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 29. `cf65e2b445329be2` — rank 155 — regex — `mig-cf65e2b4-inline-json-parse-readfilesync.rule.yaml`

- Legacy: `pattern: JSON\.parse\(\s*\S*readFileSync`; globs `packages/core/src/**/*.ts`,
  `!packages/core/src/sys/**`, `!**/*.test.ts`, `!**/*.spec.ts`; warning. Record: pattern verbatim;
  three `excludeGlobs`.
- Inventory: (i).
- Honest class: `forbidden-nested-callee-call` (regex) — a call to a fixed callee (`JSON.parse`)
  whose first argument is a call to another fixed callee (`readFileSync`, any receiver). New for the
  review. Census: 0 comment, 0 string, 6 code.
- Firing set: 6 → 6, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 30. `64bb807f4e10ea4f` — rank 157 — regex — `mig-64bb807f-typeof-object-without-null-guard.rule.yaml`

- Legacy: `pattern: typeof\s+[^\s!&|=]+\s*===\s*['"]object['"](?!\s*&&)`; globs `**/*.ts`,
  `**/*.tsx`, `**/*.js`, `**/*.jsx`, `!**/*.test.ts`; error; `manual`, `unverified`; **the
  `lessonHeading` and the `message` are both the timestamp `2026-03-07T06:05:56.069Z`** (a
  pre-registered `defective-source` candidate; carried byte-for-byte). Record:
  `pattern: typeof\s+[^\s!&|=]+\s*===\s*['"]object['"]` (the legacy pattern less its one lookahead) +
  `requires: { pattern: '\s*&&', scope: line }` (the lookahead's body verbatim);
  `excludeGlobs: ['**/*.test.ts']`; `.tsx`/`.jsx` globs kept (regex).
- Inventory: (i); **(ii)** — the pre-registration's K8b shape (§ 5.2: "`(?!\s*&&)` rewritten as
  `requires: { pattern: '&&', scope: line }` … typed `window-widened`"), declared as the
  pre-registration anticipates. Measured over the pinned tree: **removed 7, added 0 — the record
  fires nowhere on this tree.** The seven lines, verbatim from `5293614b`:
  `packages/cli/src/commands/eject.ts:309` `: h && typeof h === 'object'` ·
  `packages/cli/src/commands/init-detect.ts:282` `} else if (value && typeof value === 'object') {` ·
  `packages/cli/src/commands/init-templates.ts:1576` `} else if (bin && typeof bin === 'object') {` ·
  `packages/cli/src/commands/init.ts:779` `if (parsed !== null && typeof parsed === 'object') {` ·
  `packages/cli/src/orchestrators/orchestrator.ts:223` `(typeof current === 'object' || typeof current === 'function') &&` ·
  `packages/core/src/pack-discovery.ts:284` `(typeof callbackResult === 'object' || typeof callbackResult === 'function') &&` ·
  `packages/core/src/spine/authoring-ledger.ts:123` `if (value !== null && typeof value === 'object') {`.
  **Every one carries a null guard or a conjoined guard BEFORE the `typeof` (or a compound
  disjunction followed by `&&`), which the legacy lookahead — looking only at what follows `'object'`
  — cannot see: all seven are legacy false positives under the lesson's own intent** (the curated
  pair's `good` is exactly the guarded form). So on this tree the `window-widened` covariate removes
  false positives only and the record is, by C7, the lesson's rule; but it is also silent on every
  line of the tree, so the served rule's precision here is undefined (no true positive exists to
  keep). Curation feedback for R8: the legacy row never fired on a true positive at `5293614b`.
  **Evidence for the mmnto-ai/totem-strategy#1093 demand row (not the record):** a target-anchored
  requirement — `requires: { pattern: "['\"]object['\"]\s*&&", scope: line }` — reproduces the
  legacy exactly on this tree (7/7 firings, removed 0, added 0; `probe-64bb807f`, the translator's
  scratch measurement, its figures quoted in the pin), so a target-relative window would carry this
  rule without loss; the record carries the body form because that is the pre-registration's
  operationalisation (K8b) and the closed inventory's (ii), and a re-pin with the lookahead verbatim
  or with the anchored form is one mail away if the scorer rules that route for this rule.
- Honest class: `typeof-comparison-missing-null-guard` (regex) — a `typeof x === 'object'`
  comparison lacking a conjoined null guard. New for the review. Census: 0 comment, 1 string, 6 code.
- Firing set: 7 → 0, added 0, removed 7 (above).
- Differential satisfied (pair 0: `bad` fires; `good` carries `&& val !== null` on the line and is
  suppressed); legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 31. `87e2437431c17ec5` — rank 159 — regex — `mig-87e24374-diff-header-plus-b-literal.rule.yaml`

- Legacy: `pattern: (['"\/])\^?\+\+\+\s+b\\?\/`; globs `**/*.ts`, `**/*.js`, `**/*.py`, `**/*.sh`,
  `**/*.go`, `**/*.rs`; error; `manual`, `unverified`. Record: pattern and globs verbatim (`.py`,
  `.go`, `.rs` match 0 pinned-tree files; kept).
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed token (`+++ b/`, with or without the
  `^` anchor and the escaping backslash) inside a string or regex literal; the exemplar row's shape
  on a SOURCE scope (see 27). Census: 2 comment-context firings (comments quoting the header), 34
  string, 1 code.
- Firing set: 37 → 37, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 32. `434c51ff64ec74b6` — rank 160 — regex — `mig-434c51ff-split-on-markdown-heading.rule.yaml`

- Legacy: `pattern: \.split\(\s*(?:\/\^?#+|['"]\^?#+)`; globs `**/*.ts`, `**/*.js`, `**/*.tsx`,
  `**/*.jsx`; warning; `manual`, `unverified`. Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-callee-literal-arg` (regex) — a call to a named callee (`split`) whose
  first argument is a literal of a fixed shape (a `#`-heading regex or string). Batch 1's PAIR
  (`a190836d`), WITHHELD there on measured engine typing → this rule carries over as
  `intake-ineligible (engine-typing)`, kept out of the envelope at the intake pin, per the scorer's
  receipt. Census at this tree: 0 comment, 0 string, 2 code — reported for the record; the pair's
  verdict is the review's.
- Firing set: 2 → 2, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 33. `55797450514d4c3b` — rank 161 — regex — `mig-55797450-git-add-all.rule.yaml`

- Legacy: `pattern: git add\s+(-A|\.)\b`; globs `**/*.sh`, `**/*.bash`, `**/*.yml`, `**/*.yaml`,
  `**/*.ts`, `**/*.js`; warning; the message is the full sentence, the heading its first 60
  characters. Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed command token sequence (`git add -A` /
  `git add .`) in scripts, workflow files and source; the exemplar row's shape (see 27). Census: 0
  comment, 1 string, 1 code, 3 no-grammar (`.sh`/`.yml` files).
- Firing set: 5 → 5, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 34. `0615c43eb5a9d0e8` — rank 164 — regex — `mig-0615c43e-dot-git-existence-test.rule.yaml`

- Legacy: `pattern: (-d\s+['"]?\.git['"]?|existsSync\([^)]*['"]\.git['"]\))`; globs `**/*.sh`,
  `**/*.bash`, `**/*.js`, `**/*.ts`, `**/*.yml`, `**/*.yaml`; warning; `manual`, `unverified`.
  Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-path-literal` (regex) — the hardcoded path token `.git` as the operand of
  an existence test (`-d .git` in shell; `existsSync(… '.git')` in JS). Batch 1's PAIR (`7056157a`),
  WITHHELD there → carries over as `intake-ineligible (engine-typing)`, as `2d3ac4b9` does in batch 2. Census at this tree: 0 comment, 2 string, 7 code — reported; the pair's verdict is the review's.
- Firing set: 9 → 9, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 35. `56c801dfda484c75` — rank 167 — regex — `mig-56c801df-text-embedding-004-literal.rule.yaml`

- Legacy: `pattern: text-embedding-004`; globs `**/*.ts`, `**/*.js`, `**/*.tsx`, `**/*.jsx`,
  `**/*.json`, `**/*.env`, `**/*.yaml`, `**/*.yml`; warning; the message is the full sentence.
  Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed literal (a model identifier) anywhere
  in source and config; the exemplar row's shape (see 27). Census: 0 comment, 0 string, 3 code, 15
  no-grammar (`.json`/`.yaml` files).
- Firing set: 18 → 18, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 36. `fe1b4123aa1f679c` — rank 168 — ast-grep — `mig-fe1b4123-regex-escape-missing-hyphen.rule.yaml`

- Legacy: `astGrepPattern: $STR.replace(/[.*+?^${}()|[\]\\]/g, $REPLACEMENT)`; globs
  `packages/core/src/**/*.ts`, `!**/*.test.*`, `!**/*.spec.*`; warning. Record: `pattern` verbatim,
  `language: typescript`, the positive glob, two `excludeGlobs` (`**/*.test.*` and `**/*.spec.*`
  are dialect-clean: literal segments and `*` only; C1 passed). **The manifest's one lone compiled
  `bad`, recorded here and not as a pair (§ 4 item 5):** `legacy.badExample` =
  `str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` (the compiled row's own positive; no `goodExample`);
  the curated pair 0 carries the same shape with `raw` as the receiver and the hyphen added in
  `good`.
- Inventory: (i).
- Honest class: `forbidden-callee-literal-arg` (ast-grep) — a call to a named callee (`replace`)
  whose first argument is a fixed literal (this regex literal, the hyphen absent). Batch 1's class
  NAME under the other engine: the `(ast-grep, forbidden-callee-literal-arg)` PAIR is new for the
  review (ast-grep matches nodes, never prose — the header's own typing).
- Firing set: 5 → 5, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 37. `6f362fa28abcf94a` — rank 170 — ast-grep — `mig-6f362fa2-json-parse-as-cast-core.rule.yaml`

- Legacy: `astGrepPattern: JSON.parse($INPUT) as $TYPE`; globs `packages/core/**/*.ts`,
  `!**/*.test.ts`; warning. Record: `pattern` verbatim, `language: typescript`,
  `excludeGlobs: ['**/*.test.ts']`. Curation observation for R8: the matcher is batch 1's
  `61bb8b8b` matcher (`JSON.parse($A) as $B`, metavariable names aside) on a narrower scope; the two
  rules will fire together on `packages/core/**` files under `**/*.ts` minus their respective
  excludes — disclosed, not a translation matter.
- Inventory: (i).
- Honest class: `type-assertion-on-call` (ast-grep) — batch 1's PAIR (`61bb8b8b`), DELIVERED by the
  batch-1 review; carries over as deliverable, no second review.
- Firing set: 7 → 7, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 38. `4ac94d6f9c387e1e` — rank 173 — regex — `mig-4ac94d6f-bare-start-anchor-regex.rule.yaml`

- Legacy: `pattern: /\^[^\s\\]`; globs `packages/mcp/src/tools/**/*.ts`; warning; the message is the
  full sentence. Record: pattern and glob verbatim.
- Inventory: none.
- Honest class: `regex-literal-bare-start-anchor` (regex) — a regex literal whose start anchor is
  followed by neither a whitespace class nor an escape. New for the review. Census: 0 comment, 0
  string, 2 code, 1 in `regex` context.
- Firing set: 3 → 3, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 39. `5da43ea60b66e96e` — rank 174 — regex — `mig-5da43ea6-git-double-dash-separator.rule.yaml` (R14 seed entry 13, re-pinned)

- Legacy: `pattern: git\s+(?:log|show|diff|checkout|branch|tag|describe|rev-parse|ls-files|stash)\s+(?!.*\s--\s)(?:['"`]?\$[{(]?\w|['"`]?\$\w)`(a double-backtick span: the pattern itself contains a backtick); globs`**/\*.ts`, `**/_.js`,
`\*\*/_.sh`, `**/\*.bash`, `**/_.mjs`, `\*\*/_.cjs`; warning; **the `lessonHeading`is the timestamp`2026-03-08T02:39:04.901Z`**, the `message`the description, so the envelope's`targetDefect`carries the message's first 120 characters (the manifest's`targetDefectText`, § 4 item 6 — the
one row where the fallback recovers a description). Record:
`pattern: git\s+(?:log|show|diff|checkout|branch|tag|describe|rev-parse|ls-files|stash)\s+(?:['"`]?\$[{(]?\w|['"`]?\$\w)`(the legacy pattern less its one lookahead) +`requires: { pattern: '\s--\s', scope: line }`(the
lookahead's body less its window prefix`.\*`); globs verbatim.
- Inventory: **(ii)** — R14's own translation of this row, reproduced by the same mechanics.
  **The R14 re-pin (§ 4 item 4):** the R14 record at `78e7f196`
  (`.totem/rules/r14-5da43ea6-git-double-dash-separator.rule.yaml`) already carried the curated pair
  and this exact `pattern` + `requires:`; the re-pin adds the Baseline-5 trio (`curatedBy`,
  `curatedAt`, `baseline5Phase`) and nothing else at parse level (`diff` of the two files: quoting
  style — R14's single-quoted scalars, this generator's plain scalars — and the three added
  `curation` lines; every parsed value identical). A new record version at this pin, scored as such.
  Measured over the pinned tree: removed 0, added 0 (R14 ruling 1 recorded "suppression widens to
  whole-line; no firing case added" on its own tree; here no line exercises the widening).
- Honest class: `command-arg-missing-separator` (regex) — a git subcommand invocation with an
  interpolated positional argument and no `--` separator on the line. New for the review. Census:
  0 comment, 0 code, 1 string (the one firing in scope).
- Firing set: 1 → 1, added 0, removed 0.
- Differential satisfied (pair 0: `bad` fires; `good` carries `--` and is suppressed); legacy over
  pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

## The envelope (`.totem/spine/authored-rules.yaml`)

The shared envelope with **13 entries appended** (42 in all); the header unchanged
(`splitRef: gate5-migration-2263305c`, `authoredAfterSplit: true`, `heldOutNonInspectionAttestation:
true`); the 29 entries of batches 1 and 2 byte-identical (the generator asserted the old file a byte
prefix of the new one before writing). One entry per batch-3 record: `author: totem-claude` ·
`authoredAt: '2026-09-23'` · `targetDefect: "<lessonHash16>: <targetDefectText>"` (the manifest's
text; no N-record set, so no `@<language>` segment in this batch; on `5da43ea6` the text is the
message's first 120 characters, the timestamp-heading fallback that recovers a description) ·
`structuralClass` = the honest class above · `record: .totem/rules/<file>` · `positiveFixtures: [{pr:
2948, filePath: <the record>, matchedSpan: examples[0].bad, contentHash: sha256(examples[0].bad),
example: 0}]` — this batch's draft PR is mmnto-ai/totem#2948. The `(author, targetDefect)` identity
was checked unique over the whole file (all three batches) before the write.

**Records kept out of the envelope:** none — all 13 parse and lower. **Records the pre-pin intake
pass rejects:** every entry whose honest class is outside the five pre-release rows — expected at
this pass (§ 5 step 2) and not a fault. **Entries the pass ADMITS:** the four `forbidden-literal-token`
rows of this batch (`391de708`, `87e24374`, `55797450`, `56c801df`) — the exemplar row, under the
operator's (A): admission measured at the intake pin, flagged on R6 — and, in the shared file, batch
1's `6ad0d4d5` and batch 2's `5afaf8d0` again (the clone has no ledger row from their own passes).
**At the intake pin, under the scorer's batch-1 table:** `434c51ff` and `0615c43e` read
`intake-ineligible (engine-typing)` by carry-over and are kept out of the envelope there (the
generator's `--exclude`), with batch 1's three withheld rules and batch 2's `2d3ac4b9` below them in
the stack.

## Pre-pin pass (§ 3.3) — scratch clone, published 2.10.0

Run 2026-09-24 in a scratch clone of the branch at `0fff1730139b18413fb397d58de39bcac9093842` (the
envelope commit; `git clone --branch gate5/batch-3-2263305c --single-branch`, HEAD checked equal to
the pushed commit), never the branch checkout; the six ledger rows the pass wrote stayed in the
clone and are not on the branch. Both legs used the staging install of the PUBLISHED 2.10.0. The
logs are on the branch as `prepin-validate.log` and `prepin-intake.log` beside these notes; the
clone commit, both invocations and both exit codes are attested in `prepin-run.txt` beside them
(the captured logs carry no header of their own).

**Coverage limit of the pass, disclosed (as batches 1 and 2 disclosed it):** a whitelist miss returns
before `deriveRecordFixtures` and the record-schema parse of the entry, so on the 36 rejected entries
the dangling-ordinal and `failed validation` throws were not reached by the intake itself; they are
reached for every entry only at the post-release intake pin. The record parse, the `judgedBy ==
author` check and the `(author, targetDefect)` identity check run over the whole file before any
entry is judged and all passed.

**Validate leg** — the generalized harness in the clone, no `--tree`: exit 0; the summary lines
identical to the batch run's (13 parsed, 13 compiled, fidelity 11/13 + 2 declared, differential
13/13, `Verdict: PASS (exit 0)`). Invocation in `prepin-run.txt`; the full log in
`prepin-validate.log`.

**Intake** — `TOTEM_NO_REEXEC=1 node <staging>/node_modules/@mmnto/cli/dist/index.js rule author`
(cwd = the clone root; the CLI default `judgedBy` at this PRE-release pass). Exit 1 — the expected
outcome (§ 5 step 2): no file-aborting throw; **6 minted** (the exemplar row: batches 1 and 2's two,
this batch's four) and **36 rejected** per rule on the whitelist (batch 1's 13, batch 2's 14, this
batch's 9), each naming its `(engine, class)` pair. The minted block verbatim (the 36 rejected lines
in `prepin-intake.log`):

```text
[RuleAuthor] 6 authored rule(s): 6 minted, 0 revised, 0 unchanged.
  + 923841006dd9c024  totem-claude :: 6ad0d4d5c760a5d6: Technical documentation must avoid marketing-centric terms
  + 6e5b15c0ae7e2285  totem-claude :: 5afaf8d03f059a41: Emojis are excluded from all documentation files to adhere
  + f4538a6aa67863a3  totem-claude :: 391de7088c633579: 2026-03-03T01:52:20.000Z
  + 53926c1a10b531b9  totem-claude :: 87e2437431c17ec5: Git diff headers wrap file paths containing spaces
  + d6da524c3aec39c7  totem-claude :: 55797450514d4c3b: Never use git add -A or git add .
  + 1c3a3c4e61a2d666  totem-claude :: 56c801dfda484c75: The text-embedding-004 identifier is frequently unavailable

[RuleAuthor] WARNING: 36 rule(s) REJECTED — not structurally decidable, excluded from the producer output:
```

The nine batch-3 `intake-ineligible (whitelist)` outcomes at this pass are this batch's D1 (C)
demand figure before carry-over is applied: two of them (`434c51ff`, `0615c43e`) are batch-1 pairs
already withheld; one (`6f362fa2`) is a batch-1 pair already delivered and needs no review; six are
new pairs for the review; the class list is in the pin mail and in the per-rule notes above.

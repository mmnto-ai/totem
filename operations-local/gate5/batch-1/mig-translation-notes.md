# Gate (5) migration — batch 1 translation notes

Pre-registration: `operations/310-migration-preregistration.md` v1 at mmnto-ai/totem-strategy `b9ed654d`
(the governing text on any difference with these notes). Charter: strategy-claude's dispatch of
2026-09-23T18:48:51Z (the record on mmnto-ai/totem-strategy#288). Freeze: `operations/310-migration/inputs/manifest.json`
at strategy main `46901a04`, sha256 `2263305cfbbe8b792d8884d8091a311676ba8ddedf75e852fa9ab434de950ca5`,
53 rules; the run's `splitRef` suffix is `gate5-migration-2263305c`.

**Batch 1 = manifest `rules[]` positions 1–13 (ranks 2–75): 13 rules, 14 records** (one N = 2 set,
`71935fe9`). Translator: totem-claude. Translator ≠ scorer over every record here; the curator IS the
translator seat on three rows of this batch (`a190836d`, `87aff037`, `a1fd35ee` — totem-claude's
2026-08-24 curation), disclosed as the pre-registration § 1 discloses it (temporal separation only:
the pair was frozen before this run).

## Method

- **Source of truth per rule:** the manifest row — `legacy.{severity, message, pattern | astGrepPattern |
astGrepYamlRule, fileGlobs}` for the matcher and its scope, `curatedPair` for pair 0, `curator` /
  `curatedAt` / `lessonHash` for the curation block, `targetDefectText` for the envelope. Every such
  value was COPIED out of the manifest by a generator (the translator's scratch tool, not part of the
  pin) and round-trip-checked against it; nothing was retyped. The generalized harness's fidelity leg
  re-verifies the copy with the real parser (14/14 identical, below).
- **Record contract applied (§ 4 item 5):** `curation.sourceLesson: lesson-<lessonHash16>` ·
  `curatedBy` = the row's curator · `curatedAt` = the row's `curatedAt` (quoted, a string) ·
  `baseline5Phase: 3`; `severity` and `message` byte-for-byte; `examples[0]` = the curated pair after
  `lf` (the manifest's pairs carry no CR); `examples[1]` = the legacy compiled pair on `2266fc0d` only.
- **Closed transformation inventory (§ 3.1 C5), declared per rule below and machine-readably in
  `mig-inventory.json`** (the harness reads that file in place of R14's hand-typed divergence set):
  (i) `!`-negated legacy globs → `excludeGlobs`; (ii) a must-contain lookaround → `requires:` — **none
  in batch 1**: no regex row of this batch carries a lookaround, and the batch's one S4 row,
  `87aff037` (strata `S3-compound-ast-grep + S4-absent-must-contain + S5-explicit-exclusions`),
  carries its absence as the `not:` compound INSIDE the ast-grep rule tree, which the record keeps
  verbatim, so no `requires:` translation arises; (iii) the N-record language split.
- **Language split rule applied (§ 7 (b), "one record per language actually covered"):** a language
  is written when at least one git-tracked file of the pinned tree `5293614badd3cc5a67993abd8a6db46afb1c400f`
  matches the legacy globs of that language's registered extensions (R14's rule: globs with zero files
  dropped, `scoring.md` item 5). Census of the pinned tree (2702 tracked paths): `.tsx` 0 · `.jsx` 0 ·
  `.test.js`/`.spec.js` 0 · `.js` 7 · `.mjs` 16 · `.cjs` 7 · `.mts`/`.cts` 0. So `tsx` is never
  written; `javascript` is written only where a legacy glob names `.js` files that exist (`71935fe9`:
  `**/*.js`, 7 files). Regex rules carry every legacy glob verbatim (no language floor on regex).
  The effective-scope consequence is measured, not assumed: the firing-set leg reports `added = 0`
  and `removed = 0` on every entry union (below), and the scorer's C5 scope half decides.
- **Grammar authority:** the shipped parser and lowering of `@mmnto/totem` 2.10.0 (the translation
  pin's version, § 7 (a)), loaded from a staging install of the PUBLISHED package — never a workspace
  build (§ 2 item 10): the harness's `--core` points at
  `<staging>/node_modules/@mmnto/totem` (2.10.0, `@ast-grep/napi` 0.42.3, node v24.16.0).
- **Branch base, disclosed:** `gate5/batch-1-2263305c` is off `origin/main` at `3713c2d8` (the
  2.11.0 cut of 2026-09-23T19:08Z), as the charter says ("off origin/main"). Between the 2.10.0
  release commit `fe3af020` and `3713c2d8`, `packages/core/src` and `packages/mcp/src` are
  byte-identical and `packages/cli/src` differs only in `commands/mail.ts`, `index.ts` and three mail
  test files (`git diff --stat fe3af020 3713c2d8 -- packages/core/src packages/cli/src packages/mcp/src`);
  the intake surface (`rule-author.ts`, `authored-rule-intake.ts`, `authored-whitelist.ts`,
  `packages/core/src/spine/**`) is unchanged. The checkout declares 2.11.0 in `package.json`; every
  harness and intake run here used the 2.10.0 staging install, and the K4 header of each log says so.
- **Harness:** `operations-local/gate5/mig-harness.mjs` — a NEW file set (the two R14 scripts at
  `36312ed9` are untouched); method and additions in its header. Beyond the four pre-registered
  additions it carries, after the pin's falsification leg: C7's `runSmokeGate` reason check (the
  shipped smoke gate over every pair beside the R14-method `fires`; a reason or a disagreement is
  recorded on the pair), the engine and scope-declaration checks inside the fidelity leg (inventory
  (i) and (iii) verified by mechanism, not only declared), legacy-over-pair-0 for every parsed
  record, and a per-row field-set check against `operations-local/gate5/harness-record.schema.json`
  (schema `gate5-harness-record/1`; the additive keys named there). A declared payload divergence
  outside inventory (ii) is refused in `--set` mode (exit 2) and admitted only under `--r14`, where
  the K3 expectations file names the ruled E26 cure. Per-record output at
  `operations-local/gate5/batch-1/harness-per-record.jsonl`; the run log verbatim at
  `operations-local/gate5/batch-1/harness-run.log` (it prints the manifest's sha256); the K3
  self-check at `operations-local/gate5/k3/` (log, per-record output, the expectations file, which
  also carries R14's own declared inventory — six (i) rules, five language-narrowed rules — so the
  scope checks read R14's notes as the pre-registration says).
- **Honest structural classes (§ 3.4):** named per rule BELOW, before any intake ran and before any
  class set exists; not revised after a refusal. Disclosed: the translator built the intake and knows
  the five whitelist rows. The names are defect-SHAPE names at the granularity a decidability review
  can act on — one name per syntactic shape, shared across rules of the same shape — never the two
  exemplar rows used as buckets. Where a class's token can appear in prose or a doc-comment, the
  engine-typing question is stated for the scorer's review.

## Whole-batch transformation inventory

| Transformation                                                                                          | Count      | Rules                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| (i) `!`-negation entries → `excludeGlobs`                                                               | 7          | `54140f59`, `bc8b99e8`, `2266fc0d`, `a190836d`, `87aff037`, `61bb8b8b`, `1210f02d`                                                               |
| (ii) must-contain lookaround → `requires:`                                                              | 0          | —                                                                                                                                                |
| (iii) N-record language split                                                                           | 4 declared | `71935fe9` (N = 2: typescript + javascript); `427c97fb`, `4f283f54`, `61bb8b8b` (N = 1: the other languages' globs match zero pinned-tree files) |
| Compiled `astGrepYamlRule` config form → `target.rule` tree (the binding itself, not an inventory item) | 1          | `87aff037`                                                                                                                                       |
| Legacy compiled pair appended as `examples[1]`                                                          | 1          | `2266fc0d`                                                                                                                                       |
| Brace-glob expansion · shallow-glob promotion · `message` edits                                         | 0          | —                                                                                                                                                |
| `lessonHeading` dropped                                                                                 | 13         | the V1 grammar has no heading construct; the heading rides the envelope's `targetDefect`                                                         |

## Harness results (verbatim summary lines; full logs on the branch)

Batch 1 (`harness-run.log`, exit 0):

```
Validate: 14 record(s) — parsed 14, compiled 14, lowering-rejected 0, harness failures 0; expectation mismatches 0
Fidelity (records): 14/14 identical, 0 expected divergence(s), 0 UNEXPECTED
Fidelity (entries): 13/13 identical, 0 expected divergence(s), 0 UNEXPECTED
Differential split (measured, per entry):
  differential-satisfied   13  (entries 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)
  good-also-fires          0
  bad-does-not-fire        0
  not-evaluable            0
Differential expectation mismatches: 0
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

Legacy-row-over-pair-0 (the `defective-source` discriminator): `bad=FIRES good=silent` on all 13 rules —
the frozen matcher discriminates its own curated pair on every row of this batch. Firing-set leg over
the pinned tree: `added = 0`, `removed = 0` on every entry union (per-entry counts in the per-rule
notes; the per-record count of a single language record of an N-record set is partial by construction
and the delta is the entry's).

K3 self-check (`k3/k3-run.log`, exit 0) over the 22 R14 records at `78e7f196` under the same 2.10.0
staging core, `--seed seed-20.json --corpus compiled-rules.json --r14` (both inputs identity-checked
against the manifest's blob ids `23889360…` and `589f3f16…`):

```
Validate: 22 record(s) — parsed 22, compiled 21, lowering-rejected 1, harness failures 0; expectation mismatches 0
Fidelity (records): 20/22 identical, 2 expected divergence(s), 0 UNEXPECTED
Fidelity (entries): 18/20 identical, 2 expected divergence(s), 0 UNEXPECTED
  differential-satisfied   15  (entries 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 18, 19, 20)
  good-also-fires          3  (entries 11, 14, 15)
  bad-does-not-fire        1  (entries 17)
  not-evaluable            1  (entries 12)
  candidates: 7, total hits: 0 (a dead matcher scores 0)   [controls 1/1]
  REPRODUCED — differential split and dead-matcher probe match the notes.
```

**K3 fidelity figure, a disclosure for the scorer (ask-back sent by mail before this pin):** the
pre-registered expectation reads "19/20 identical with one expected divergence (`5da43ea6`)". That
figure is `scoring.md` item 3's, measured at the REGISTERED pin `2a713576`. At `78e7f196` — the E26
cure pin the manifest names — entry 4 (`0e01112d`) carries the pattern `\bnew\s+Error\(` where the
frozen row carries `\bnew\s+(?!Totem)Error\(`: the cure removed the inert lookahead (the commit
subject at `78e7f196` says so; every other byte identical). So the honest K3 figure at `78e7f196` is
**18/20 identical + 2 declared divergences (`5da43ea6` by inventory (ii); `0e01112d` by the ruled
E26 cure) + 0 unexpected.** The harness accepts the cure only through an explicit
`expectedPayloadDivergence` declaration in the K3 expectations file (`k3/k3-r14-inventory.json`); in
the migration run that field is unused and every payload delta is (ii) or unexpected. No conjunct
moves; the K3 control's expected wording is the scorer's to revise (a v1.1 revision class).

## Per-rule notes (manifest order)

Fields: legacy construct → record construct · inventory · honest class (engine) · pinned-tree
firing set (legacy → record, union for a set) · notes.

### 1. `427c97fb0063f0cb` — rank 2 — ast-grep — `mig-427c97fb-partial-matcher-secret-masking.rule.yaml`

- Legacy: `astGrepPattern: expect($VAL).toContain($EXPECTED)`; globs `**/*.test.ts`, `**/*.spec.ts`,
  `**/*.test.tsx`, `**/*.spec.tsx`, `**/*.test.js`, `**/*.spec.js`; warning. Record: `pattern` verbatim,
  `language: typescript`, `fileGlobs` = the two `.ts` globs.
- Inventory: (iii), N = 1 — the `.tsx` and `.js` test globs match 0 pinned-tree files (census above).
- Honest class: `forbidden-callee-call` (ast-grep) — a call expression whose callee is a fixed member
  chain; matches nodes, never prose.
- Firing set: 2638 → 2638, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 2. `71935fe9a742137b` — rank 10 — ast-grep — `mig-71935fe9-string-cast-on-input.rule.yaml` + `…-js.rule.yaml` (N = 2)

- Legacy: `astGrepPattern: String($INPUT)`; globs `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`; warning.
  Records: typescript over `**/*.ts`; javascript over `**/*.js` (7 pinned-tree files). `.tsx`/`.jsx`
  (tsx) match 0 files. R14 seed entry 18 — the two R14 records at `78e7f196` re-pinned: pair 0 was
  already the curated pair (§ 4 item 4); the curation block gained the Baseline-5 trio; the
  `fileGlobs` and payload are the R14 records' own.
- Inventory: (iii), N = 2. Envelope identities `71935fe9a742137b@typescript` / `@javascript`.
- Honest class: `forbidden-callee-call` (ast-grep), both records.
- Firing set (union): 511 → 511, added 0, removed 0 (the javascript record fires 0 times on the 7
  `.js` files; the typescript record carries all 511).
- Differential satisfied on both records; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 3. `54140f59be3e6e44` — rank 25 — regex — `mig-54140f59-bare-issue-number-refs.rule.yaml`

- Legacy: `pattern: (^|[^a-zA-Z0-9-_./])#\d+`; globs `packages/cli/**/*.ts`, `apps/cli/**/*.ts`,
  `!**/*.test.ts`; error; `manual`, `unverified`. Record: pattern verbatim; `excludeGlobs: ['**/*.test.ts']`.
  R14 seed entry 5 — the R14 record re-pinned with **pair 0 REPLACED** by the curated pair (§ 4 item 4:
  the R14 record carried a different `examples[0]`); the curation block gained the trio.
- Inventory: (i).
- Honest class: `bare-issue-reference` (regex) — a `#<digits>` token not preceded by an owner/repo
  qualifier. Engine-typing note for the scorer: the legacy regex matches the token wherever it
  appears in a source file — code, string literals and comments alike (the frozen row's own
  behaviour; the manifest's `sourceRef` says only "when aggregating multiple sources, use qualified
  syntax like owner/repo#number"); whether a comment hit is a true positive for this rule is the
  engine-typing review's question and is not settled here.
- Firing set: 335 → 335, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 4. `4f283f5495489a19` — rank 35 — ast-grep — `mig-4f283f54-inline-fs-rmsync-in-tests.rule.yaml`

- Legacy: `astGrepPattern: fs.rmSync($$$ARGS)`; globs `**/*.test.ts`, `**/*.test.js`, `**/*.spec.ts`,
  `**/*.spec.js`; warning. Record: typescript over the two `.ts` globs.
- Inventory: (iii), N = 1 — `.test.js`/`.spec.js` match 0 pinned-tree files.
- Honest class: `forbidden-callee-call` (ast-grep).
- Firing set: 124 → 124, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 5. `bc8b99e815c3943f` — rank 41 — ast-grep — `mig-bc8b99e8-console-log-in-mcp.rule.yaml`

- Legacy: `astGrepPattern: console.log($$$ARGS)`; globs `packages/mcp/**/*.ts`, `!**/*.test.ts`; warning.
  Record: typescript; `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i).
- Honest class: `forbidden-callee-call` (ast-grep).
- Firing set: 49 → 49, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 6. `2266fc0dfe824f24` — rank 44 — ast-grep — `mig-2266fc0d-static-named-import-totem-barrel.rule.yaml`

- Legacy: `astGrepPattern: import { $$$NAMES } from '@mmnto/totem'`; globs `packages/cli/src/commands/**/*.ts`,
  `!**/*.test.ts`, `!**/*.spec.ts`; error; the one row with a complete compiled pair. Record:
  typescript; two `excludeGlobs`; `examples[1]` = the legacy `badExample`/`goodExample` verbatim
  (§ 4 item 5). The curated `good` is the `import type` + dynamic-import shape; measured: the pattern
  is silent on `import type { … }` (pair 0 and pair 1 both satisfied).
- Inventory: (i).
- Honest class: `static-import-from-module` (ast-grep) — a static import declaration whose source is a
  fixed module specifier.
- Firing set: 15 → 15, added 0, removed 0.
- Differential satisfied on both pairs; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 7. `a190836df4daa24d` — rank 46 — regex — `mig-a190836d-raw-git-exec.rule.yaml`

- Legacy: pattern ``(?:execFileSync|safeExec)\(\s*['"`]git['"`]`` (a double-backtick span: the
  pattern itself contains a backtick); globs `**/*.ts`, `!packages/core/src/sys/git.ts`,
  `!**/*.test.ts`, `!**/*.spec.ts`; warning. Record: pattern verbatim; `fileGlobs: ['**/*.ts']`;
  `excludeGlobs: ['packages/core/src/sys/git.ts', '**/*.test.ts', '**/*.spec.ts']`.
- Inventory: (i).
- Honest class: `forbidden-callee-literal-arg` (regex) — a call to a named callee whose first argument
  is a fixed string literal. Engine-typing note: the token can appear in a doc-comment (a comment
  quoting the banned call); the legacy regex accepts that; the scorer's review decides.
- Firing set: 75 → 75, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat; temporal separation only).

### 8. `87aff037d7de47a7` — rank 47 — ast-grep — `mig-87aff037-fail-open-catch-ban.rule.yaml`

- Legacy: `astGrepYamlRule: {rule: {kind: catch_clause, not: {has: {kind: throw_statement, stopBy: end}}}}`;
  globs `packages/**/*.ts`, `!**/*.test.ts`, `!**/*.spec.ts`; error; `manual`; the two-paragraph
  message carried byte-for-byte (a `|-` block scalar). Record: `target.rule` = the unwrapped legacy
  tree, key order kept (`JSON.stringify`-equal, the fidelity leg's own check); two `excludeGlobs`.
  R14 seed entry 3 — the R14 record re-pinned with **pair 0 REPLACED** by the curated pair (§ 4 item 4)
  and the trio added.
- Inventory: (i).
- Honest class: `catch-without-rethrow` (ast-grep) — a catch clause with no throw statement anywhere
  in its subtree.
- Firing set: 604 → 604, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 9. `a1fd35ee696110b0` — rank 49 — ast-grep — `mig-a1fd35ee-dynamic-import-in-utility-layers.rule.yaml`

- Legacy: `astGrepPattern: import($MODULE)`; globs `packages/cli/src/utils/**/*.ts`,
  `packages/cli/src/adapters/**/*.ts`, `packages/cli/src/lib/**/*.ts`; warning. Record: typescript;
  globs verbatim.
- Inventory: none.
- Honest class: `forbidden-callee-call` (ast-grep) — the dynamic `import(…)` call expression.
- Firing set: 55 → 55, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 10. `61bb8b8b88d2ecab` — rank 55 — ast-grep — `mig-61bb8b8b-json-parse-as-cast.rule.yaml`

- Legacy: `astGrepPattern: JSON.parse($A) as $B`; globs `**/*.ts`, `**/*.tsx`, `!**/registry.ts`; warning;
  `manual`, `unverified`; the message is the heading. Record: typescript over `**/*.ts`;
  `excludeGlobs: ['**/registry.ts']`.
- Inventory: (i); (iii) N = 1 — `**/*.tsx` matches 0 pinned-tree files.
- Honest class: `type-assertion-on-call` (ast-grep) — an `as` type assertion whose operand is a
  fixed call expression.
- Firing set: 91 → 91, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 11. `6ad0d4d5c760a5d6` — rank 59 — regex — `mig-6ad0d4d5-marketing-terms-in-docs.rule.yaml`

- Legacy: `pattern: \b(guarantees?|comprehensive|…|future-proof)\b` (the 15-term alternation, verbatim);
  globs `**/*.md`, `**/*.mdx`, `**/*.rst`, `**/*.txt`; warning. Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a banned word list in prose files. This IS the
  exemplar class's shape and is named honestly, not as a bucket: the rule's whole target is prose, so
  the engine-typing rule's prose concern is the rule's intent. **Disclosed (a question for the
  scorer):** this class is a row of the SHIPPED pre-release table (`regex/forbidden-literal-token`,
  one of the two mechanism-validating exemplar rows in `authored-whitelist.ts`), so the intake ADMITS
  this entry at the pre-release table with no class review in between — the pre-pin pass minted it
  (`923841006dd9c024`). The whitelist header's engine-typing rule says a forbidden-token class whose
  token can appear in prose must be `ast-grep`; this rule's tokens are prose words in prose files.
  Whether the exemplar row is a legitimate delivery for this rule, or the entry should be typed
  `intake-ineligible (engine-typing)` and the class re-reviewed, is the scorer's to rule; the pin
  mail asks it.
- Firing set: 169 → 169, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 12. `1210f02da9f16e5b` — rank 68 — ast-grep — `mig-1210f02d-raw-error-throw-in-cli.rule.yaml`

- Legacy: `astGrepPattern: throw new Error($MSG)`; globs `packages/cli/**/*.ts`, `!**/*.test.ts`; warning;
  a duplicate-group survivor. Record: typescript; `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i).
- Honest class: `forbidden-constructor-throw` (ast-grep) — a throw statement whose argument constructs
  a fixed class.
- Firing set: 20 → 20, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 13. `7056157a6bf72fa8` — rank 75 — regex — `mig-7056157a-hardcoded-git-hooks-path.rule.yaml`

- Legacy: pattern ``[\/'"`]?\.git[\/]hooks`` (a double-backtick span: the pattern itself contains
  a backtick); globs `**/*.ts`, `**/*.js`, `**/*.sh`, `**/*.bash`, `**/*.mjs`, `**/*.cjs`; warning.
  Record: pattern and globs verbatim (`**/*.bash` matches 0 pinned-tree files and is kept: regex
  records have no language floor and the glob is dialect-clean).
- Inventory: none.
- Honest class: `forbidden-path-literal` (regex) — a hardcoded path token. Engine-typing note: the
  token can appear in a comment; the legacy regex accepts that; the scorer's review decides.
- Firing set: 71 → 71, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

## The envelope (`.totem/spine/authored-rules.yaml`)

Header `splitRef: gate5-migration-2263305c` (free-text lane, § 2 item 5), `authoredAfterSplit: true`,
`heldOutNonInspectionAttestation: true`. One entry per record (14): `author: totem-claude` ·
`authoredAt: '2026-09-23'` · `targetDefect: "<lessonHash16>[@<language>]: <targetDefectText>"` (the
manifest's text; `@<language>` on both `71935fe9` records only) · `structuralClass` = the honest class
above · `record: .totem/rules/<file>` · `positiveFixtures: [{pr: <this batch's draft PR>, filePath:
<the record>, matchedSpan: examples[0].bad, contentHash: sha256(examples[0].bad), example: 0}]`.
The fixture `contentHash` recipe is the smoke envelope's own, reproduced on `r14-0167a783` at
`200404bf` (sha256 of the `examples[0].bad` text = `60c2f189…`, the committed value).

**Records kept out of the envelope:** none — all 14 parse and lower. **Records the pre-pin intake
pass rejects:** every entry whose honest class is outside the five pre-release whitelist rows — expected
at this pass (§ 5 step 2 of the charter) and not a fault; the class loop (D1 (C)) decides admission.
**One entry the pass ADMITS:** `6ad0d4d5` — its honest class is an exemplar row of the pre-release
table (see its per-rule note); disclosed, and the scorer's to rule on.

## Pre-pin pass (§ 3.3) — scratch clone, published 2.10.0

Run 2026-09-23 in a scratch clone of the branch at `d0ccb50b4619c339d78fc359971b0747519aafd8` (the
envelope commit; `git clone --branch gate5/batch-1-2263305c --single-branch`), never the branch
checkout; the ledger row the pass wrote (`.totem/spine/authoring-ledger.ndjson`, one row for the
one minted entry) stayed in the clone and is not on the branch. Both legs used the staging install
of the PUBLISHED 2.10.0 (`<staging>/node_modules/@mmnto/{cli,totem}`; napi 0.42.3; node v24.16.0).
The logs are on the branch as `prepin-validate.log` and `prepin-intake.log` beside these notes.

**Coverage limit of the pass, disclosed:** in `authored-rule-intake.ts` a whitelist miss returns
before `deriveRecordFixtures` and the record-schema parse of the entry, so on the thirteen rejected
entries the dangling-ordinal and `failed validation` throws were not reached by the intake itself;
they are reached for every entry only at the post-release intake pin. The falsification leg over
this pin (2026-09-23) exercised both directly over all 14 entries (`deriveRecordFixtures` plus the
fixture schema: all derive and validate) — the leg's measurement, recorded here as such, not the
seat's.

**Validate leg** — the generalized harness in the clone, no `--tree` (the firing-set leg is the
batch run's, above): exit 0.

```text
node operations-local/gate5/mig-harness.mjs --set operations-local/gate5/manifest-2263305c.json --only 427c97fb,71935fe9,54140f59,4f283f54,bc8b99e8,2266fc0d,a190836d,87aff037,a1fd35ee,61bb8b8b,6ad0d4d5,1210f02d,7056157a --inventory operations-local/gate5/batch-1/mig-inventory.json --core <staging>/node_modules/@mmnto/totem --cli <staging>/node_modules/@mmnto/cli
```

Summary lines (the full log in `prepin-validate.log`):

```text
Validate: 14 record(s) — parsed 14, compiled 14, lowering-rejected 0, harness failures 0; expectation mismatches 0
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

**Intake** — the verbatim invocation (cwd = the clone root; `TOTEM_NO_REEXEC=1` so the published
binary runs itself and never delegates to a checkout's dist; no `--judged-by`, so the CLI default
`static-whitelist@cert-1` applied — this is the PRE-release pass, the intake pin's run will carry
`--judged-by static-whitelist@gate5-<setSha8>` explicit):

```text
TOTEM_NO_REEXEC=1 node <staging>/node_modules/@mmnto/cli/dist/index.js rule author
```

Exit 1 — the expected outcome at this pass (§ 5 step 2 of the charter): no file-aborting throw
(the record parse, `judgedBy == author`, the repeated `(author, targetDefect)` identity, the
dangling fixture ordinal and the `failed validation` path all passed); one entry minted
(`6ad0d4d5`, class `forbidden-literal-token`, a row of the pre-release table) and thirteen rejected
per rule on the whitelist, each naming its `(engine, class)` pair. Output verbatim:

```text
[RuleAuthor] 1 authored rule(s): 1 minted, 0 revised, 0 unchanged.
  + 923841006dd9c024  totem-claude :: 6ad0d4d5c760a5d6: Technical documentation must avoid marketing-centric terms

[RuleAuthor] WARNING: 13 rule(s) REJECTED — not structurally decidable, excluded from the producer output:
  x totem-claude :: 427c97fb0063f0cb: Avoid using partial matchers like toContain when testing: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 71935fe9a742137b@javascript: Using String() casting on input patterns can lead to silent: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 71935fe9a742137b@typescript: Using String() casting on input patterns can lead to silent: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 54140f59be3e6e44: Issue numbers are only unique within a single repository;: no unambiguous whitelist match for (regex, bare-issue-reference) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 4f283f5495489a19: Replacing inline fs.rmSync calls with a shared helper: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: bc8b99e815c3943f: Standard console.log or console.error calls in MCP tools: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 2266fc0dfe824f24: Static top-level imports from heavy internal packages delay: no unambiguous whitelist match for (ast-grep, static-import-from-module) — not structurally decidable (ADR-112 §3)
  x totem-claude :: a190836df4daa24d: Use git adapter instead of raw git execution: no unambiguous whitelist match for (regex, forbidden-callee-literal-arg) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 87aff037d7de47a7: Ban fail-open catch blocks that skip re-throwing: no unambiguous whitelist match for (ast-grep, catch-without-rethrow) — not structurally decidable (ADR-112 §3)
  x totem-claude :: a1fd35ee696110b0: Dynamic imports intended for performance optimization: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 61bb8b8b88d2ecab: Perform explicit null and type checks on the results: no unambiguous whitelist match for (ast-grep, type-assertion-on-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 1210f02da9f16e5b: Using domain-specific error subclasses instead of raw Error: no unambiguous whitelist match for (ast-grep, forbidden-constructor-throw) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 7056157a6bf72fa8: Instead of hardcoding .git/hooks, use 'git rev-parse: no unambiguous whitelist match for (regex, forbidden-path-literal) — not structurally decidable (ADR-112 §3)
```

The thirteen `intake-ineligible (whitelist)` outcomes are the D1 (C) demand figure for this batch;
the class list is in the pin mail and in the per-rule notes above.

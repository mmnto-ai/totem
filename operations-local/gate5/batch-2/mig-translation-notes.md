# Gate (5) migration — batch 2 translation notes

Pre-registration: `operations/310-migration-preregistration.md` v1.1 at mmnto-ai/totem-strategy
`6fee96b5` (v1 at `b9ed654d`; the governing text on any difference with these notes). Charter:
strategy-claude's dispatch of 2026-09-23T18:48:51Z (the record on mmnto-ai/totem-strategy#288); the
batch-2 sequencing ruled in the scorer's receipt of 2026-09-23T20:26:43Z ("batch 2 starts on the
standing greenlight"). Freeze: `operations/310-migration/inputs/manifest.json` at strategy main
`46901a04`, sha256 `2263305cfbbe8b792d8884d8091a311676ba8ddedf75e852fa9ab434de950ca5`, 53 rules; the
run's `splitRef` suffix is `gate5-migration-2263305c`.

**Batch 2 = manifest `rules[]` positions 14–26 (ranks 77–141): 13 rules, 15 records** (two N = 2 sets,
`06282905` and `240f19ca`). Translator: totem-claude. Translator ≠ scorer over every record here; the
curator IS the translator seat on two rows of this batch (`81f72c85`, `7cdfa106` — totem-claude's
2026-08-24 curation), disclosed as the pre-registration § 1 discloses it (temporal separation only:
the pair was frozen before this run). **This batch carries the run's first inventory (ii)
declarations** — the three target-adjacent negative lookaheads `638d6fcc`, `24f112fe`, `487a0a23`
translated to `requires:` at the `line` window, the widening measured (below).

**Stacking, disclosed:** the branch `gate5/batch-2-2263305c` is off the batch-1 pin `49754e9c` (not
off `origin/main`), because the generalized harness, the frozen manifest copy, the K3 expectations
file and the `.prettierignore` line live only on that branch until mmnto-ai/totem#2945 merges; the
batch-1 records and envelope are therefore present here unchanged (`git diff 49754e9c..HEAD --
.totem/rules/mig-<batch-1 hash8>-*` is empty for every batch-1 record). The batch-2 draft PR targets
the batch-1 branch and re-targets to `main` when that branch merges.

## Method

- **Source of truth per rule:** the manifest row — `legacy.{severity, message, pattern | astGrepPattern |
astGrepYamlRule, fileGlobs}` for the matcher and its scope, `curatedPair` for pair 0, `curator` /
  `curatedAt` / `lessonHash` for the curation block, `targetDefectText` for the envelope. Every such
  value was COPIED out of the frozen manifest copy (sha256-checked by the generator before any read)
  by a generator (the translator's scratch tool, not part of the pin) and round-trip-checked against
  it FROM THE WRITTEN FILE; nothing was retyped. The generalized harness's fidelity leg re-verifies
  the copy with the real parser (12/15 identical + 3 declared (ii) divergences + 0 unexpected, below).
- **Record contract applied (§ 4 item 5):** `curation.sourceLesson: lesson-<lessonHash16>` ·
  `curatedBy` = the row's curator · `curatedAt` = the row's `curatedAt` (quoted, a string) ·
  `baseline5Phase: 3`; `severity` and `message` byte-for-byte; `examples[0]` = the curated pair after
  `lf` (the manifest's pairs carry no CR); no row of this batch carries a legacy compiled pair, so
  `examples` has exactly one pair on every record.
- **Closed transformation inventory (§ 3.1 C5), declared per rule below and machine-readably in
  `mig-inventory.json`** (the harness reads that file in place of R14's hand-typed divergence set):
  (i) `!`-negated legacy globs → `excludeGlobs`; (ii) a must-contain lookaround → `requires:` (the
  `line` window) — **three declared in batch 2**, applied mechanically as R14 applied it to
  `5da43ea6` (`(?!.*\s--\s)` → `requires: '\s--\s'`): the negative lookahead is removed from the
  pattern as ONE exact substring (the generator asserts it is present exactly once) and its body,
  less the window prefix it carried, becomes `requires.pattern` with `scope: line`; nothing else in
  the pattern moves, and the notes quote both sides per rule; (iii) the N-record language split.
- **Why (ii) and not the lookahead verbatim (§ 7 (b), the translator's declaration):** the shipped
  regex gate (`validateRegex`: `new RegExp` + `safe-regex2`) accepts a lookahead, so a verbatim
  pattern would parse and lower — but the pre-registration § 2 item 1 names each of these three as a
  target-adjacent or bounded lookahead whose only V1 window is `line` (§ 2 item 8: "a `requires:`
  window of `line` is the only V1 window for a target-adjacent requirement"), and C3's mechanical
  rule decides the declaration by the firing-set delta: no added firing = a right declaration;
  removed-only = PASS with the `window-widened` covariate; any added firing = `matcher-drift`. Each
  of the three is a suppress-when-present condition on the same line as the target — mechanically
  what `requires:` expresses — so (ii) is the honest first-class translation and the widening is a
  measurement, not a choice. Measured: **added 0 on all three; removed 1 on `24f112fe` and 1 on
  `487a0a23` (each quoted in its per-rule note), removed 0 on `638d6fcc`.** By construction the
  record fires only where the legacy fires (the record's target is the legacy pattern less its
  lookahead, and the record is silent whenever the requirement is present anywhere on the line,
  which includes the legacy's narrower window), so an added firing was not expected and none was
  measured.
- **Language split rule applied (§ 7 (b), "one record per language actually covered"):** a language
  is written when at least one git-tracked file of the pinned tree `5293614badd3cc5a67993abd8a6db46afb1c400f`
  matches the legacy globs of that language's registered extensions (R14's rule: globs with zero files
  dropped, `scoring.md` item 5). Census of the pinned tree (2702 tracked paths), re-derived for this
  batch: `.tsx` 0 · `.jsx` 0 · `.test.js`/`.spec.js` 0 · `.test.tsx`/`.spec.tsx` 0 · `.js` 7 · `.md`
  1856 · `.mdx` 0 · `.sh` 9 · `.json` 47 · `.yml` 16 · `.yaml` 6. So `tsx` is never written;
  `javascript` is written where a legacy glob names `.js` files that exist (`06282905`, `240f19ca`:
  `**/*.js`, 7 files). Regex rules carry every legacy glob verbatim (no language floor on regex; a
  regex glob matching zero files — `**/*.mdx`, `**/*.tsx`, `**/*.jsx` on the regex rows below — is
  kept). The effective-scope consequence is measured, not assumed: the firing-set leg reports
  `added = 0` on every entry union and `removed` as declared above; the scorer's C5 scope half decides.
- **Grammar authority:** the shipped parser and lowering of `@mmnto/totem` 2.10.0 (the translation
  pin's version, § 7 (a)), loaded from a fresh staging install of the PUBLISHED package in this
  session's scratchpad (`@mmnto/cli` 2.10.0, `@mmnto/totem` 2.10.0, `@ast-grep/napi` 0.42.3, node
  v24.16.0) — never a workspace build (§ 2 item 10): the harness's `--core` points at
  `<staging>/node_modules/@mmnto/totem`. The checkout declares 2.11.0 in `package.json`; the intake
  surface is byte-identical to the 2.10.0 release commit (the batch-1 notes' measurement stands, the
  base commit is unchanged).
- **Harness:** `operations-local/gate5/mig-harness.mjs` **reused byte-for-byte at the batch-1 pin
  `49754e9c`** (charter § 5 step 3: "later batches reuse it at its commit or a disclosed successor");
  no harness change in this batch. Its (ii) handling is the one the pin carries: the fidelity leg
  reads `requires:` present iff (ii) is declared, excuses the payload delta under (ii) as
  `payload (inventory ii)`, and the firing-set leg applies the shipped `requiresSuppressesMatch` to
  the record's firings. Per-record output at `operations-local/gate5/batch-2/harness-per-record.jsonl`
  (schema `gate5-harness-record/1`, 15 lines); the run log verbatim at
  `operations-local/gate5/batch-2/harness-run.log` (it prints the manifest's sha256). The K3
  self-check re-run from this worktree at `operations-local/gate5/batch-2/k3-run.log` and
  `k3-per-record.jsonl`, against the batch-1 expectations file `operations-local/gate5/k3/k3-r14-inventory.json`.
- **Honest structural classes (§ 3.4):** named per rule BELOW, before any intake ran and before any
  class set exists; not revised after a refusal. Disclosed: the translator built the intake and knows
  the five whitelist rows. The names are defect-SHAPE names at the granularity a decidability review
  can act on — one name per syntactic shape, shared across rules of the same shape and with batch 1's
  names where the shape is batch 1's — never the two exemplar rows used as buckets. **Carry-over
  (the scorer's receipt, ruling 2):** a class already among batch 1's reviewed set needs no second
  review; each per-rule note says whether its `(engine, class)` PAIR is batch 1's or only the class
  NAME is (the whitelist keys on the pair, and engine typing is half of the review, so a batch-1
  class under the other engine is named as new for the review's purpose). Where a class's token can
  appear in prose or a doc-comment, the engine-typing question is stated for the scorer's review.

## Whole-batch transformation inventory

| Transformation                                                  | Count      | Rules                                                                                                                                        |
| --------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) `!`-negation entries → `excludeGlobs`                       | 5          | `24f112fe`, `fb05f895`, `487a0a23`, `7cdfa106`, `240f19ca`                                                                                   |
| (ii) must-contain lookaround → `requires:` (`line` window)      | 3          | `638d6fcc` (removed 0), `24f112fe` (removed 1), `487a0a23` (removed 1); added 0 on all three                                                 |
| (iii) N-record language split                                   | 4 declared | `06282905`, `240f19ca` (N = 2: typescript + javascript); `329479bf`, `f202f65f` (N = 1: the `.tsx` globs match zero pinned-tree files)       |
| Legacy compiled pair appended as `examples[1]`                  | 0          | — (no row of this batch carries one)                                                                                                         |
| Brace-glob expansion · shallow-glob promotion · `message` edits | 0          | — (`packages/cli/src/utils.ts` on `7cdfa106` is a literal path, dialect-clean, kept)                                                         |
| `lessonHeading` dropped                                         | 13         | the V1 grammar has no heading construct; the heading rides the envelope's `targetDefect`                                                     |
| Legacy `manual` / `unverified` flags dropped                    | 5          | `638d6fcc`, `24f112fe`, `81f72c85`, `487a0a23`, `7cdfa106` carry them on the frozen row; the grammar has no such field; nothing else changes |

## Harness results (verbatim summary lines; full logs on the branch)

Batch 2 (`harness-run.log`, exit 0):

```
Validate: 15 record(s) — parsed 15, compiled 15, lowering-rejected 0, harness failures 0; expectation mismatches 0
Fidelity (records): 12/15 identical, 3 expected divergence(s), 0 UNEXPECTED
Fidelity (entries): 10/13 identical, 3 expected divergence(s), 0 UNEXPECTED
Differential split (measured, per entry):
  differential-satisfied   13  (entries 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26)
  good-also-fires          0
  bad-does-not-fire        0
  not-evaluable            0
Differential expectation mismatches: 0
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

The three expected divergences are the three (ii) rows (`fidelity: payload (inventory ii) (expected)`,
`requires` present as declared, `unexpected: []` on each). Legacy-row-over-pair-0 (the
`defective-source` discriminator): `bad=FIRES good=silent` on all 13 rules — the frozen matcher
discriminates its own curated pair on every row of this batch. Firing-set leg over the pinned tree:
`added = 0` on every entry union; `removed = 0` on eleven entries, `removed = 1` on `24f112fe`
(`packages/core/src/errors.ts:131`) and on `487a0a23` (`packages/cli/src/commands/hook-run.ts:5`),
each quoted in its per-rule note. The entry numbers in the log are manifest positions (14–26). The
harness notes the fourteen batch-1 record files outside the selected set as ignored (the stacking).

K3 self-check (`k3-run.log`, exit 0) over the 22 R14 records at `78e7f196` under the same 2.10.0
staging core, `--seed seed-20.json --corpus compiled-rules.json --r14` (both inputs identity-checked
against the manifest's blob ids `23889360…` and `589f3f16…` by `git hash-object`; the corpus sha256
`bb4c800a…`), from this worktree:

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

**`k3-per-record.jsonl` is byte-identical to the batch-1 pin's `operations-local/gate5/k3/k3-per-record.jsonl`**
(`cmp` exit 0): the harness is unchanged, the core is the same published version, and the R14 records
are the same pin; the K3 log differs from batch 1's only in the K4 header's paths (this session's
staging install and worktree). The figure stands as ruled (v1.1): 18/20 + 2 declared + 0 unexpected.

## Per-rule notes (manifest order)

Fields: legacy construct → record construct · inventory · honest class (engine) · pinned-tree
firing set (legacy → record, union for a set) · notes.

### 14. `5afaf8d03f059a41` — rank 77 — regex — `mig-5afaf8d0-emoji-in-docs.rule.yaml`

- Legacy: `pattern` = a single character class of emoji ranges and code points (54 UTF-16 code
  units: `[☀-➿` … `㊙]`, carrying the surrogate ranges `\uD83C-\uDBFF` and `\uDC00-\uDFFF` as lone
  code units — under the runtime's `new RegExp(pattern)` with no `u` flag these match any surrogate
  code unit, i.e. any astral character); globs `**/*.md`, `**/*.mdx`; warning. Record: pattern
  verbatim — on disk a double-quoted YAML scalar with the two lone surrogates as `\ud83c` / `\udfff`
  escapes and the paired `􏰀` written as one literal astral character, which the `yaml`
  parser returns as the legacy string byte-for-byte (the generator's round trip from the written
  file; the harness fidelity leg: identical); globs verbatim (`**/*.mdx` matches 0 pinned-tree
  files; kept — regex, no language floor).
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a forbidden literal (here a character set)
  occurring in prose files, the matcher a context-free literal alternation: the same syntactic
  shape as batch 1's `6ad0d4d5` (a word list in prose), named the same. **This IS the exemplar row
  of the shipped pre-release table, so the intake admits this entry at the pre-pin pass with no
  class review in between (as `6ad0d4d5`'s was).** The scorer's ruling 1 on the batch-1 pin
  (2026-09-23T20:26Z) grounded that row's legitimacy on the rule's PROSE-ONLY scope (the prose
  occurrence IS the target, so the engine-typing seam does not exist for it); this rule's scope is
  `**/*.md`, `**/*.mdx` and nothing else — the same ground holds verbatim, and the pin says so.
- Firing set: 39 → 39, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 15. `329479bf34f8816f` — rank 78 — ast-grep — `mig-329479bf-zod-string-array-min1.rule.yaml`

- Legacy: `astGrepPattern: z.array(z.string())`; globs `**/*.ts`, `**/*.tsx`; warning. Record:
  `pattern` verbatim, `language: typescript`, `fileGlobs: ['**/*.ts']`.
- Inventory: (iii), N = 1 — `**/*.tsx` matches 0 pinned-tree files.
- Honest class: `forbidden-fixed-call-expression` (ast-grep) — a call expression matched in full,
  callee AND argument list fixed (no metavariable): `z.array(…)` is not forbidden as a callee, only
  with the argument `z.string()`, so this is a narrower shape than batch 1's `forbidden-callee-call`
  (a fixed callee with free arguments) and is named as its own shape. New for the review.
- Firing set: 49 → 49, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 16. `638d6fcc8a601da0` — rank 87 — regex — `mig-638d6fcc-execfilesync-git-shell-option.rule.yaml`

- Legacy: `pattern: execFileSync\s*\(\s*['"]git['"](?![^)]*shell:\s*(?:true|IS_WIN))`; globs
  `**/*.ts`, `**/*.js`, `**/*.tsx`, `**/*.jsx`; warning; `manual`, `unverified`. Record:
  `pattern: execFileSync\s*\(\s*['"]git['"]` (the legacy pattern less its one lookahead) +
  `requires: { pattern: 'shell:\s*(?:true|IS_WIN)', scope: line }` (the lookahead's body less its
  window prefix `[^)]*`); globs verbatim (`.tsx`/`.jsx` match 0 files; kept — regex).
- Inventory: **(ii)** — a must-contain bounded by the call's closing parenthesis (`[^)]*`), which
  the `line` window widens to the whole line (§ 2 item 1 names this row). Measured: removed 0,
  added 0 over the pinned tree — no line in scope carries `shell:\s*(?:true|IS_WIN)` outside the
  call and after the target, so the widening produced no delta here (no `window-widened` covariate
  arises on this tree; the seam remains and is disclosed).
- Honest class: `callee-literal-arg-missing-option` (regex) — a call to a named callee whose first
  argument is a fixed string literal, lacking a required option in its argument list (batch 1's
  `forbidden-callee-literal-arg` target shape, `a190836d`, plus a must-contain). New for the review.
  Engine-typing note: the target token can appear in a doc-comment; the legacy regex accepts that.
- Firing set: 24 → 24, added 0, removed 0.
- Differential satisfied (pair 0: `bad` fires, `good` carries `{ shell: IS_WIN }` on the line and is
  suppressed); legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 17. `06282905d061ca34` — rank 100 — ast-grep — `mig-06282905-execsync-call.rule.yaml` + `…-js.rule.yaml` (N = 2)

- Legacy: `astGrepPattern: execSync($$$ARGS)`; globs `**/*.ts`, `**/*.js`, `**/*.tsx`, `**/*.jsx`;
  warning; a duplicate-group survivor. Records: typescript over `**/*.ts`; javascript over `**/*.js`
  (7 pinned-tree files). `.tsx`/`.jsx` (tsx) match 0 files.
- Inventory: (iii), N = 2. Envelope identities `06282905d061ca34@typescript` / `@javascript`.
- Honest class: `forbidden-callee-call` (ast-grep), both records — batch 1's PAIR (engine and
  class); no second review under ruling 2.
- Firing set (union): 55 → 55, added 0, removed 0 (the javascript record fires 3 times on the `.js`
  files; the typescript record carries 52).
- **Curation observation, disclosed (never an edit):** the legacy `lessonHeading` — and so the
  manifest's `targetDefectText` and the envelope identity — reads "Diagnostic hints must precisely
  identify the underlying", while the legacy `message`, the matcher and the curated pair are about
  `execSync` → `execFileSync`; the heading names a different clause of `lesson-804f3379` than the
  row's matcher does. The envelope carries the heading (the manifest's rule, § 4 item 6). A
  `defective-source`-class observation on a passing rule for R8, the scorer's to route.
- Differential satisfied on both records; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 18. `24f112fe3a6679bd` — rank 103 — regex — `mig-24f112fe-error-message-prefix.rule.yaml`

- Legacy: ``pattern: \bnew\s+\w*Error\(\s*['"`](?!\[Totem Error\])`` (a double-backtick span: the
  pattern itself contains a backtick); globs `**/*.ts`, `**/*.js`, `!**/*.test.ts`; error;
  `manual`, `unverified`. Record: ``pattern: \bnew\s+\w*Error\(\s*['"`]`` (the legacy pattern less
  its one lookahead) + `requires: { pattern: '\[Totem Error\]', scope: line }` (the lookahead's body
  verbatim); `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i); **(ii)** — a must-contain anchored at the start of the message literal, which the
  `line` window widens to the whole line (§ 2 item 1 names this row). Measured: **removed 1, added
  0** — `packages/core/src/errors.ts:131`, the source line verbatim on the line after the write
  shield's quotation directive:
  <!-- totem-context: verbatim quotation of the pinned-tree source line at 5293614b; the bare reference inside it is the file's own comment, not a reference made here -->
  ``throw new TotemParseError(`${label}: ${getErrorMessage(err)}`, hint, err); // totem-ignore — #848: TotemError constructor auto-prepends [Totem Error]``
  The legacy fires (the literal after the backtick is not the prefix); the record is silent
  because the trailing comment carries `[Totem Error]` on the same line. A removed-only delta:
  C3's rule reads the declaration as right and the rule PASSES with the `window-widened` covariate
  (a mmnto-ai/totem-strategy#1093 demand row). Note for the scorer: that line also carries a
  `totem-ignore` marker, which neither harness leg honours (both count raw firings), so at runtime
  the legacy firing would be suppressed by the marker anyway; the delta is real at the matcher
  level and is reported as measured.
- Honest class: `constructor-literal-arg-missing-prefix` (regex) — a constructor call of a fixed
  class family whose string-literal first argument lacks a required prefix. New for the review.
  Engine-typing note: the token can appear in a doc-comment; the legacy regex accepts that.
- Firing set: 19 → 18, added 0, removed 1 (above).
- Differential satisfied (pair 0: `bad` fires; `good` carries the prefix on the line and is
  suppressed); legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 19. `fb05f895862808e6` — rank 113 — regex — `mig-fb05f895-direct-child-process-import.rule.yaml`

- Legacy: `pattern: (?:from|require\()\s*['"](?:node:)?child_process['"]`; globs `**/*.ts`,
  `**/*.js`, `!packages/core/src/sys/**`, `!**/*.test.ts`, `!**/*.spec.ts`, `!**/*.test.js`,
  `!**/*.spec.js`; error. Record: pattern verbatim (the `(?:…)` groups are non-capturing groups,
  not lookarounds); `fileGlobs: ['**/*.ts', '**/*.js']`; the five `!`-entries as `excludeGlobs`.
- Inventory: (i).
- Honest class: `forbidden-module-import` (regex) — an import declaration or a `require` call whose
  module specifier is a fixed forbidden module (`child_process`, with or without the `node:`
  prefix). Distinct from batch 1's `static-import-from-module` (a static import from a module that
  should be loaded lazily): here the module is forbidden in both forms. New for the review.
  Engine-typing note: the specifier can appear in a doc-comment; the legacy regex accepts that.
- Firing set: 36 → 36, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 20. `81f72c855eba4229` — rank 117 — regex — `mig-81f72c85-promise-allsettled.rule.yaml`

- Legacy: `pattern: Promise\.allSettled`; globs `**/cli/**/*.ts`, `**/totem/**/*.ts`,
  `**/orchestrator/**/*.ts`; warning; `manual`, `unverified`; **the `lessonHeading` and the
  `message` are both the ISO-8601 timestamp `2026-03-06T05:32:34.074Z`** (`headingIsTimestamp:
true`; one of the three rows § 4 item 6 pre-registers as `defective-source` candidates). Record:
  pattern and globs verbatim (`**/totem/**/*.ts` and `**/orchestrator/**/*.ts` match 0 pinned-tree
  files; kept — regex); `message` byte-for-byte = the timestamp (a finding, never an edit); the
  envelope's `targetDefect` carries the timestamp too (the manifest's `targetDefectText`, the
  message fallback yielding the heading again), so the `lessonHash16` prefix alone carries the
  meaning in the ledger — disclosed as § 4 item 6 discloses it.
- Inventory: none.
- Honest class: `forbidden-callee-call` (regex) — the defect is a call to a forbidden callee
  (`Promise.allSettled(…)`, the curated pair's shape); the legacy regex matches the member token
  without requiring the call parentheses, so it also fires on a bare member access or a doc-comment
  mention. Batch 1's class NAME (`a1fd35ee` and four others, all ast-grep); the `(regex,
forbidden-callee-call)` PAIR is new, and the engine-typing question — a regex for a callee-call
  class on a source scope fires in a doc-comment — is the review's; not named
  `forbidden-literal-token` because that would name the matcher's shape, not the defect's, and would
  route a source-scoped regex through the exemplar row.
- Firing set: 3 → 3, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat; temporal separation only).

### 21. `3c7773706e5b3b2d` — rank 119 — regex — `mig-3c777370-brace-expansion-glob.rule.yaml`

- Legacy: `pattern: \*\.\{[^}]+\}`; globs `**/*.ts`, `**/*.js`, `**/*.json`, `**/*.yml`,
  `**/*.yaml`; warning; the message is the full sentence (the heading its first 60 characters,
  carrying a literal backslash before the asterisk: `Brace expansion (e.g., \*.{ts,js}) is not
universally` — the envelope's `targetDefect` carries it as the manifest does). Record: pattern
  and globs verbatim.
- Inventory: none.
- Honest class: `brace-expansion-glob-literal` (regex) — a glob literal written with brace expansion
  (`*.{…}`), a literal-content shape decided by a regex over the text (the `bare-issue-reference`
  kind of shape: a pattern-shaped token, not a fixed word). New for the review. Engine-typing note:
  the scope spans source (`.ts`, `.js`) and data (`.json`, `.yml`, `.yaml`) files, and the token can
  appear in a source comment; the legacy regex accepts that.
- Firing set: 26 → 26, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 22. `487a0a23bd24569d` — rank 129 — regex — `mig-487a0a23-static-import-in-cli-commands.rule.yaml`

- Legacy: `pattern: ^import\s+(?!type\s)(?!\s*\{[^}]*Error).*from\s+['"](?:\.\.\/|@[\w-]+\/)`; globs
  `packages/cli/src/commands/**/*.ts`, `!**/*.test.ts`; warning; `manual`, `unverified`. Record:
  `pattern: ^import\s+.*from\s+['"](?:\.\.\/|@[\w-]+\/)` (the legacy pattern less its two adjacent
  lookaheads, removed as one exact substring) + `requires: { pattern: 'type\s|\s*\{[^}]*Error',
scope: line }` (the two lookahead bodies verbatim, joined as an alternation);
  `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i); **(ii)** — two target-adjacent exemptions (a type-only import; an import whose
  clause names an `Error` class), each a suppress-when-present condition anchored right after
  `import\s+`, which the `line` window widens to the whole line (§ 2 item 1 names this row's
  `(?!type\s)`). Measured: **removed 1, added 0** — `packages/cli/src/commands/hook-run.ts:5`:
  `import { evaluateHook, formatRejection, type ToolCallPayload } from '../hook/runtime.js';` — the
  legacy fires (not an `import type` declaration, no `Error` in the clause); the record is silent
  because the inline `type` specifier puts `type\s` on the line. A removed-only delta: the
  declaration reads as right under C3's rule and the rule PASSES with the `window-widened`
  covariate (a mmnto-ai/totem-strategy#1093 demand row); the widening here is the more consequential
  of the two in this batch, since that import does load a value binding statically — the covariate
  names a real weakening of the served rule, reported as measured.
- Honest class: `static-import-from-module` (regex) — a static import declaration whose source is a
  fixed module family (`../` relative or `@scope/` packages), with exemptions. Batch 1's class NAME
  (`2266fc0d`, ast-grep, and the same lesson family: the heading is the same sentence); the `(regex,
static-import-from-module)` PAIR is new and its engine typing is the review's.
- Firing set: 30 → 29, added 0, removed 1 (above).
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 23. `7cdfa1069477b69a` — rank 137 — regex — `mig-7cdfa106-dynamic-import-outside-cli-entry.rule.yaml`

- Legacy: `pattern: \bimport\s*\(`; globs `packages/core/src/**/*.ts`,
  `packages/cli/src/adapters/**/*.ts`, `packages/cli/src/utils.ts`, `!**/*.test.ts`; warning;
  `manual`, `unverified`. Record: pattern verbatim; the three positive globs verbatim
  (`packages/cli/src/adapters/**/*.ts` matches 0 pinned-tree files, kept; `packages/cli/src/utils.ts`
  is a literal path, dialect-clean, kept); `excludeGlobs: ['**/*.test.ts']`.
- Inventory: (i).
- Honest class: `forbidden-callee-call` (regex) — the dynamic `import(…)` call expression, batch
  1's `a1fd35ee` defect shape under the other engine: the class NAME is batch 1's, the `(regex,
forbidden-callee-call)` PAIR is new (see 20); the token can appear in a doc-comment.
- Firing set: 33 → 33, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 24. `f202f65f8a198f18` — rank 138 — ast-grep — `mig-f202f65f-bare-rejects-tothrow.rule.yaml`

- Legacy: `astGrepPattern: await expect($PROMISE).rejects.toThrow()`; globs `**/*.test.ts`,
  `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`; warning. Record: typescript over the two `.ts`
  globs.
- Inventory: (iii), N = 1 — the two `.tsx` test globs match 0 pinned-tree files.
- Honest class: `callee-call-without-argument` (ast-grep) — a call on a fixed callee chain with an
  empty argument list where an argument is required (the bare `toThrow()`); the defect is the
  ABSENCE of the argument, which is why it is not `forbidden-callee-call` (the callee itself is
  fine). New for the review.
- Firing set: 8 → 8, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 25. `2d3ac4b9516ed9b6` — rank 140 — regex — `mig-2d3ac4b9-gemini-md-lowercase-path.rule.yaml`

- Legacy: `pattern: \.gemini/gemini\.md`; globs `**/*.ts`, `**/*.js`, `**/*.json`, `**/*.yaml`,
  `**/*.yml`, `**/*.sh`, `**/*.md`; warning. Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-path-literal` (regex) — a hardcoded path token; batch 1's PAIR
  (`7056157a`, regex); no second review under ruling 2. The batch-1 engine-typing note applies
  unchanged (the token can appear in a comment; here also in prose, `**/*.md` being in scope, where
  the prose occurrence is a true positive for this rule).
- Firing set: 20 → 20, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 26. `240f19cae3e56b10` — rank 141 — ast-grep — `mig-240f19ca-process-exit-call.rule.yaml` + `…-js.rule.yaml` (N = 2)

- Legacy: `astGrepPattern: process.exit($CODE)`; globs `**/*.ts`, `**/*.js`, `!**/*.test.ts`,
  `!**/*.test.js`; warning. Records: typescript over `**/*.ts`; javascript over `**/*.js` (7
  pinned-tree files); both carry the two `!`-entries as `excludeGlobs` (the harness's (i) check is
  set-equality with the legacy `!`-entries per record).
- Inventory: (i); (iii), N = 2. Envelope identities `240f19cae3e56b10@typescript` / `@javascript`.
- Honest class: `forbidden-callee-call` (ast-grep), both records — batch 1's PAIR; no second review
  under ruling 2.
- Firing set (union): 23 → 23, added 0, removed 0 (the javascript record fires 2 times on the `.js`
  files; the typescript record carries 21).
- Differential satisfied on both records; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

## The envelope (`.totem/spine/authored-rules.yaml`)

The batch-1 envelope with **15 entries appended** (29 in all); the header unchanged
(`splitRef: gate5-migration-2263305c`, free-text lane, § 2 item 5; `authoredAfterSplit: true`;
`heldOutNonInspectionAttestation: true`); batch 1's 14 entries byte-identical (the generator asserted
the old file a byte prefix of the new one before writing). One entry per batch-2 record:
`author: totem-claude` · `authoredAt: '2026-09-23'` · `targetDefect: "<lessonHash16>[@<language>]:
<targetDefectText>"` (the manifest's text; `@<language>` on both records of `06282905` and of
`240f19ca`) · `structuralClass` = the honest class above · `record: .totem/rules/<file>` ·
`positiveFixtures: [{pr: 2947, filePath: <the record>, matchedSpan: examples[0].bad, contentHash:
sha256(examples[0].bad), example: 0}]` — this batch's draft PR is mmnto-ai/totem#2947. The
`(author, targetDefect)` identity was checked unique over the whole file (both batches) before the
write. The generator now carries an `--exclude <hash8,…>` option for a record that must stay out of
the envelope (a record that did not parse or lower, § 3.3) — unused in this batch: all 15 parse and
lower.

**Records kept out of the envelope:** none. **Records the pre-pin intake pass rejects:** every
entry whose honest class is outside the five pre-release whitelist rows — expected at this pass
(§ 5 step 2 of the charter) and not a fault; the class loop (D1 (C)) decides admission. **Entries the
pass ADMITS:** `5afaf8d0` — its honest class is the exemplar row of the pre-release table, on a
prose-only scope (see its per-rule note; the batch-1 ruling's ground) — and, in the shared file,
batch 1's `6ad0d4d5` again (its own pass minted it; the clone here has no ledger row from that pass,
so it mints again).

## Pre-pin pass (§ 3.3) — scratch clone, published 2.10.0

Run 2026-09-23 in a scratch clone of the branch at `4732a1c4e15e2cf8ced25bf099ed70ef393b2fff` (the
envelope commit; `git clone --branch gate5/batch-2-2263305c --single-branch`, HEAD checked equal to
the pushed commit), never the branch checkout; the ledger rows the pass wrote
(`.totem/spine/authoring-ledger.ndjson`, two rows for the two minted entries) stayed in the clone
and are not on the branch. Both legs used the staging install of the PUBLISHED 2.10.0
(`<staging>/node_modules/@mmnto/{cli,totem}`; napi 0.42.3; node v24.16.0). The logs are on the branch
as `prepin-validate.log` and `prepin-intake.log` beside these notes.

**Coverage limit of the pass, disclosed (as batch 1 disclosed it):** in `authored-rule-intake.ts` a
whitelist miss returns before `deriveRecordFixtures` and the record-schema parse of the entry, so on
the 27 rejected entries the dangling-ordinal and `failed validation` throws were not reached by the
intake itself; they are reached for every entry only at the post-release intake pin. The record
parse, the `judgedBy == author` check and the `(author, targetDefect)` identity check run over the
whole file before any entry is judged and all passed (no throw; the run reached its per-rule
verdicts).

**Validate leg** — the generalized harness in the clone, no `--tree` (the firing-set leg is the
batch run's, above): exit 0.

```text
node operations-local/gate5/mig-harness.mjs --set operations-local/gate5/manifest-2263305c.json --only 5afaf8d0,329479bf,638d6fcc,06282905,24f112fe,fb05f895,81f72c85,3c777370,487a0a23,7cdfa106,f202f65f,2d3ac4b9,240f19ca --inventory operations-local/gate5/batch-2/mig-inventory.json --core <staging>/node_modules/@mmnto/totem --cli <staging>/node_modules/@mmnto/cli
```

Summary lines (the full log in `prepin-validate.log`):

```text
Validate: 15 record(s) — parsed 15, compiled 15, lowering-rejected 0, harness failures 0; expectation mismatches 0
Fidelity (records): 12/15 identical, 3 expected divergence(s), 0 UNEXPECTED
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

**Intake** — the verbatim invocation (cwd = the clone root; `TOTEM_NO_REEXEC=1` so the published
binary runs itself and never delegates to a checkout's dist; no `--judged-by`, so the CLI default
`static-whitelist@cert-1` applied — this is the PRE-release pass, the intake pin's run will carry
`--judged-by static-whitelist@gate5-<setSha8>` explicit):

```text
TOTEM_NO_REEXEC=1 node <staging>/node_modules/@mmnto/cli/dist/index.js rule author
```

Exit 1 — the expected outcome at this pass (§ 5 step 2 of the charter): no file-aborting throw;
two entries minted (`6ad0d4d5` and `5afaf8d0`, both class `forbidden-literal-token`, the
pre-release table's exemplar row) and 27 rejected per rule on the whitelist (batch 1's 13 and this
batch's 14), each naming its `(engine, class)` pair. Output verbatim (the full log in
`prepin-intake.log`):

```text
[RuleAuthor] 2 authored rule(s): 2 minted, 0 revised, 0 unchanged.
  + 923841006dd9c024  totem-claude :: 6ad0d4d5c760a5d6: Technical documentation must avoid marketing-centric terms
  + 6e5b15c0ae7e2285  totem-claude :: 5afaf8d03f059a41: Emojis are excluded from all documentation files to adhere

[RuleAuthor] WARNING: 27 rule(s) REJECTED — not structurally decidable, excluded from the producer output:
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
  x totem-claude :: 329479bf34f8816f: Use .min(1) on string schemas in config arrays: no unambiguous whitelist match for (ast-grep, forbidden-fixed-call-expression) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 638d6fcc8a601da0: Windows requires shell:true for git binary resolution: no unambiguous whitelist match for (regex, callee-literal-arg-missing-option) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 06282905d061ca34@javascript: Diagnostic hints must precisely identify the underlying: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 06282905d061ca34@typescript: Diagnostic hints must precisely identify the underlying: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 24f112fe3a6679bd: Standardize exception messages with a consistent prefix: no unambiguous whitelist match for (regex, constructor-literal-arg-missing-prefix) — not structurally decidable (ADR-112 §3)
  x totem-claude :: fb05f895862808e6: Forbid direct child_process — use safeExec: no unambiguous whitelist match for (regex, forbidden-module-import) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 81f72c855eba4229: 2026-03-06T05:32:34.074Z: no unambiguous whitelist match for (regex, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 3c7773706e5b3b2d: Brace expansion (e.g., \*.{ts,js}) is not universally: no unambiguous whitelist match for (regex, brace-expansion-glob-literal) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 487a0a23bd24569d: Static top-level imports from heavy internal packages delay: no unambiguous whitelist match for (regex, static-import-from-module) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 7cdfa1069477b69a: Dynamic imports should be limited to CLI command entry: no unambiguous whitelist match for (regex, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: f202f65f8a198f18: When testing expected failures, assert the specific error: no unambiguous whitelist match for (ast-grep, callee-call-without-argument) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 2d3ac4b9516ed9b6: The Gemini CLI and Gemini Code Assist (GCA) do not: no unambiguous whitelist match for (regex, forbidden-path-literal) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 240f19cae3e56b10@javascript: Throwing specific error classes like TotemParseError: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
  x totem-claude :: 240f19cae3e56b10@typescript: Throwing specific error classes like TotemParseError: no unambiguous whitelist match for (ast-grep, forbidden-callee-call) — not structurally decidable (ADR-112 §3)
```

The fourteen batch-2 `intake-ineligible (whitelist)` outcomes are the D1 (C) demand figure for this
batch (eight `(engine, class)` pairs new for the review; two pairs batch 1's, awaiting that batch's
delivery; one the exemplar row); the class list is in the pin mail and in the per-rule notes above.

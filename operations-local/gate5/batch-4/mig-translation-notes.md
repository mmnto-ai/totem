# Gate (5) migration — batch 4 translation notes

Pre-registration: `operations/310-migration-preregistration.md` **v1.3** at mmnto-ai/totem-strategy
`729fa215` (mmnto-ai/totem-strategy#1424; v1 at `b9ed654d`, v1.1 at `6fee96b5`; the governing text
on any difference with these notes). Charter: strategy-claude's dispatch of 2026-09-23T18:48:51Z (the
record on mmnto-ai/totem-strategy#288); batch 4 on the standing greenlight per the scorer's receipt
of 2026-09-24T00:13:54Z § 4 and the batch-3 pin mail's expected-action line. Freeze:
`operations/310-migration/inputs/manifest.json` at strategy main `46901a04`, sha256
`2263305cfbbe8b792d8884d8091a311676ba8ddedf75e852fa9ab434de950ca5`, 53 rules; the run's `splitRef`
suffix is `gate5-migration-2263305c`.

**Batch 4 = manifest `rules[]` positions 40–53 (ranks 176–198), the last batch: 14 rules, 15
records** (one N = 2 set, `fb008f77`, typescript + javascript). Translator: totem-claude. The
curator IS the translator seat on six rows of this batch (`884becd4`, `8435c024`, `8213cd4e`,
`b34d9515`, `7e3eefea`, `b3e3e2b3` — totem-claude's 2026-08-24 curation), disclosed as § 1
discloses it (temporal separation only). This batch carries: three inventory (ii) declarations
(`b34d9515`, an allow-list lookahead whose alternation body is the requirement; `7e3eefea`, a
separator lookahead; `b3e3e2b3`, the § Design 8 exemplar-pair rule — the frozen matcher fires on its
own curated `good`, the pre-registration's standing `defective-source` case, and the line-window
requirement discriminates the pair); one N = 2 language split; three ast-grep rows whose
other-language legacy globs match zero tracked files of the pinned tree and are dropped with their
language (`427481b5` tsx, `5c5fe9d9` javascript, `d487264e` tsx); two truncated legacy texts carried
byte-for-byte (`8435c024`'s message and heading end mid-sentence at "do not"; `b34d9515`'s message
ends with a comma) and one truncated heading (`b3e3e2b3`); two duplicate-group survivors
(`089b0c62`, `427481b5`, the manifest's `duplicateGroupSurvivor: true`, a curation fact, no
translation matter).

**Stacking, disclosed:** the branch `gate5/batch-4-2263305c` is off the batch-3 pin `7c145212`
(mmnto-ai/totem#2948), itself off the batch-2 pin `ef21defc` (mmnto-ai/totem#2947) and the batch-1
pin `49754e9c` (mmnto-ai/totem#2945), because the harness, the frozen manifest copy, the K3
expectations file and the `.prettierignore` line live only on that stack until it merges; batches
1–3's records and envelope entries are present here unchanged. The batch-4 draft PR targets the
batch-3 branch and re-targets when that branch merges. The manifest-only refresh (D2) runs at this
pin too (`records_hash` re-attested over the 57 tracked records, `compiled_at` restamped, nothing
else), because the pre-push compile-manifest arm requires it. **The four foreseeable merges and the
sequencing rule** are the batch-2 notes' (their stacking paragraph): the `compile-manifest.json`
restamp conflicts by construction; the shared envelope is not append-only past an earlier batch's
intake pin; `judgedBy` sits inside the ledger row's `authoringContentHash`, so a later batch's
intake over carried entries under a different set id would read them `revised`; after a squash the
base pin is not an ancestor of `main`. So batch 4's intake step runs only after the batches below it
merge and `main` is brought in by MERGE (never a rebase; no raw ref-delete of a base branch), the
envelope reconciled to the post-intake entries below (the generator's `--exclude`), the ledger rows
carried forward, the manifest-only refresh last.

**What the scorer's batch-1 review and delivery changed for this batch (its receipt of
2026-09-24T00:13Z and its delivery of 2026-09-24T00:28Z, verified at strategy `729fa215`):** engine
typing (whitelist rule 2) is MEASURED — the frozen regex per line over the pinned tree's in-scope
files, every firing classified by the shipped `classifyLines`; a `comment`-context firing is the
token appearing in a doc-comment and fails the class as the header's sentence reads. So these notes
carry that measurement per regex rule up front (`census-batch-4.txt`, the scorer's own instrument
`class-review/census-comment-firings.mjs` at `729fa215`, run by the translator over this batch's
eight regex rules with the same staging install and tree; counts below): **zero comment-context
firings on all eight at this tree.** The batch-1 class set is DELIVERED as data: five ast-grep rows
(`forbidden-callee-call` among them) in mmnto-ai/totem#2949 under the set id
`static-whitelist@gate5-6cba5706`, awaiting the operator's merge word and the `@mmnto/cli` patch
cut; the three batch-1 regex classes withheld on measured engine typing stay withheld, and two of
this batch's pairs carry over as withheld by that table (below). The operator's word of 2026-09-24
(relayed 00:18Z) on the exemplar row: **(A)** — a rule whose honest class is
`regex/forbidden-literal-token` is NOT `intake-ineligible`; its admission is measured at the intake
pin like any record's and flagged on R6; (C), a scope clause in the header, is held for the report.

## Method

- **Source of truth per rule:** the manifest row — `legacy.{severity, message, pattern |
astGrepPattern, fileGlobs}` for the matcher and its scope, `curatedPair` for pair 0, `curator` /
  `curatedAt` / `lessonHash` for the curation block, `targetDefectText` for the envelope. Every such
  value was COPIED out of the frozen manifest copy (sha256-checked by the generator before any read)
  by a generator (the translator's scratch tool, not part of the pin) and round-trip-checked against
  it FROM THE WRITTEN FILE; nothing was retyped. The generalized harness's fidelity leg re-verifies
  the copy with the real parser on the twelve identical records (12/15 identical + 3 declared (ii)
  divergences + 0 unexpected, below); **on the three (ii) rows it checks only that a `requires:`
  block is present and excuses the payload delta** (the pin's harness, unchanged), so their record
  pattern and `requires.pattern` are checked by the generator's assertion (the strip substring
  present exactly once; no lookaround left in the pattern after the strip) and by the falsification
  leg over this pin; the per-rule notes quote both sides for the scorer's C3 read.
- **Record contract applied (§ 4 item 5):** `curation.sourceLesson: lesson-<lessonHash16>` ·
  `curatedBy` = the row's curator · `curatedAt` = the row's `curatedAt` (quoted, a string) ·
  `baseline5Phase: 3`; `severity` and `message` byte-for-byte; `examples[0]` = the curated pair after
  `lf`; no legacy compiled example (bad or good) exists on any row of this batch, so `examples` has
  exactly one pair on every record.
- **Closed transformation inventory (§ 3.1 C5), declared per rule below and machine-readably in
  `mig-inventory.json`:** (i) `!`-negated legacy globs → `excludeGlobs`; (ii) a must-contain
  lookaround → `requires:` (the `line` window) — three declared, applied mechanically as batches 2
  and 3 applied it (the lookahead removed from the pattern as ONE exact substring, asserted present
  exactly once; its body, less the `.*` window prefix it carried, the `requires.pattern` with
  `scope: line`; nothing else in the pattern moves): `b34d9515` `(?!mcp\/mcp\.json|guidelines\.md)`
  → `requires: 'mcp\/mcp\.json|guidelines\.md'` (the alternation kept whole; no window prefix);
  `7e3eefea` `(?! [—–-] .+)` → `requires: ' [—–-] .+'` (kept whole; no window prefix); `b3e3e2b3`
  `(?!.*LC_ALL=C)` → `requires: 'LC_ALL=C'` (the `.*` prefix dropped, R14's `5da43ea6` mechanics);
  (iii) the N-record language split by pinned-tree coverage — one record per language whose legacy
  globs match at least one tracked file of the pinned tree, carrying every legacy glob of that
  language (same-language zero-file globs kept, as batch 2's `f202f65f` kept `**/*.spec.ts`); a
  language with zero coverage is dropped with its globs: `fb008f77` N = 2 (typescript `**/*.ts`;
  javascript `**/*.js`, 7 files; tsx and jsx dropped, 0 files), `427481b5` (tsx dropped:
  `packages/core/**/*.tsx` 0 files), `d487264e` (tsx dropped: `**/*.test.tsx`, `**/*.spec.tsx` 0
  files), `5c5fe9d9` (javascript dropped: `packages/core/**/*.js`, `src/**/*.js`, `lib/**/*.js` 0
  files; its `src/**/*.ts` and `lib/**/*.ts`, also 0 files, are kept as same-language globs).
- **The (ii) choice and its ground (§ 7 (b); the batch-2 notes' wording stands):** declaring (ii) is
  the translator's choice — the shipped regex gate accepts a lookahead — and its ground is C3's
  conjunct, "no opaque escape or regex hack standing in for a first-class construct", read with § 2
  item 8's "the only V1 window for a target-adjacent requirement is `line`"; `requires:` is the
  § Design 8 absence construct (a target match fires iff `requires.pattern` does NOT match within the
  window), which is exactly what each of the three lookaheads asserts one position to the right of
  the target. The cost, the widening, is measured by the firing-set leg, and C3's mechanical rule
  reads the declaration by its delta (no added firing = right; removed-only = PASS with the
  `window-widened` covariate). **Measured: added 0 on all three; removed 4 on `b34d9515`
  (quoted in its note: four lines that name `.junie/AGENTS.md` beside an allowed name), removed 0 on
  `7e3eefea` and on `b3e3e2b3`.** On `b3e3e2b3` the legacy matcher fires on the curated `good`
  (`LC_ALL=C git log --oneline`: the lookahead looks only to the right of `git `) and the record is
  silent on it (the requirement is on the line) — the cure the pre-registration's `defective-source`
  paragraph anticipates ("a `requires:` translation under C3 may cure it, in which case no miss
  stands"); the record's differential is satisfied and the legacy-over-pair-0 leg reports
  `good=FIRES`, the K9 shape, as the scorer's control K9 measures it.
- **Language split rule applied (§ 7 (b), "one record per language actually covered"):** the census
  of the pinned tree `5293614badd3cc5a67993abd8a6db46afb1c400f` (2702 tracked paths), re-derived for
  this batch with `git ls-files`: `packages/core/**/*.ts` 302 · `packages/core/**/*.tsx` 0 ·
  `packages/core/**/*.js` 0 · `src/**/*.ts` 0 · `src/**/*.js` 0 · `lib/**/*.ts` 0 · `lib/**/*.js`
  0 · `**/*.tsx` 0 · `**/*.jsx` 0 · `**/*.js` 7 · `**/*.test.ts` 337 · `**/*.spec.ts` 0 ·
  `**/*.test.tsx` 0 · `**/*.spec.tsx` 0 · `packages/cli/src/**/*.ts` 335. Regex rules carry every
  legacy glob verbatim (no language floor on regex): `**/*.zsh` (0 files) and `.claude/**/*` (18
  files) on `61dcb058`, `**/Makefile` (0) on `884becd4`, `**/*.txt` (2) and `**/package.json` on
  `8435c024`, `**/.gitignore` (1) on `b34d9515` — zero-file globs kept.
- **Grammar authority:** the shipped parser and lowering of `@mmnto/totem` 2.10.0 (the translation
  pin's version, § 7 (a)), the staging install of the PUBLISHED package made for batch 2
  (`@mmnto/cli` 2.10.0, `@mmnto/totem` 2.10.0, `@ast-grep/napi` 0.42.3, node v24.16.0) — never a
  workspace build; the harness's `--core` points at `<staging>/node_modules/@mmnto/totem`.
- **Harness:** `operations-local/gate5/mig-harness.mjs` **reused byte-for-byte at the batch-1 pin
  `49754e9c`** (charter § 5 step 3); no harness change in this batch. Per-record output at
  `operations-local/gate5/batch-4/harness-per-record.jsonl` (schema `gate5-harness-record/1`, 15
  lines); the run log verbatim at `operations-local/gate5/batch-4/harness-run.log`; the K3
  self-check re-run from this worktree at `operations-local/gate5/batch-4/k3-run.log` and
  `k3-per-record.jsonl`, against `operations-local/gate5/k3/k3-r14-inventory.json`.
- **Honest structural classes (§ 3.4):** named per rule BELOW, before any intake ran; not revised
  after a refusal. Disclosed: the translator built the intake and knows the whitelist rows (five
  shipped; five more delivered in mmnto-ai/totem#2949, unmerged as these notes are written). The
  names are defect-SHAPE names at the granularity a decidability review can act on, shared with
  batches 1–3 where the shape is theirs. **Carry-over, read against the scorer's batch-1 table at
  `729fa215` and its delivery (pairs, not names):** `(ast-grep, forbidden-callee-call)` is DELIVERED
  — `427481b5`, `5c5fe9d9`, `63680bf3` carry over as deliverable, no second review;
  `(regex, forbidden-callee-literal-arg)` and `(regex, forbidden-path-literal)` were WITHHELD on
  measured engine typing — `61dcb058` and `b34d9515` carry over as `intake-ineligible
(engine-typing)`, kept out of the envelope at the intake pin, whatever their own census counts read
  (both read zero comment-context firings here; the pair is withheld, and the pair is the whitelist's
  key); `(regex, forbidden-literal-token)` is the exemplar row — three rules of this batch name it
  honestly (`884becd4`, `8435c024`, `4ae0a01d`: each a fixed literal token sequence), mint at the
  pre-pin pass, and read under the operator's (A): admission measured at the intake pin, flagged on
  R6. **Six pairs are new for the review:** `(ast-grep, forbidden-object-member-call)` (`089b0c62`),
  `(ast-grep, named-callee-argument-shape)` (`fb008f77`), `(regex, close-keyword-issue-list)`
  (`8213cd4e`), `(regex, heading-missing-required-separator)` (`7e3eefea`),
  `(ast-grep, try-block-expect-fail-with-catch)` (`d487264e`),
  `(regex, command-missing-required-env-token)` (`b3e3e2b3`). The census count per regex rule is
  stated in each note for the review's rule 2.
- **The whitelist header vs the shipped predicate** (the batch-2 notes' disclosure, still owed to the
  class review): the header calls a class under two engines AMBIGUOUS while the predicate filters on
  both engine and class, and the eligibility `basis` string carries no engine.

## Disclosures for the class review (§ 3.4; no class renamed)

- **The exemplar row's (A) on this batch's three rules.** The batch-3 notes disclosed that (A) was
  ruled on prose-only records and that batch 3 extended it to source-scoped rules carrying
  doc-comment firings. This batch's three `regex/forbidden-literal-token` rules carry NO
  comment-context firing at this tree: `4ae0a01d` is prose-only (`docs/wiki/**/*.md`, 0 firings);
  `884becd4` and `8435c024` reach scripts and config files beside prose (`**/*.sh`, `**/*.yml`,
  `**/package.json`, `**/Makefile`, …) and every firing at this tree sits in a `.md` or `.txt` file
  the classifier has no grammar for (9 and 12 `no-grammar` lines, none in a source file). So the
  batch-3 question (whether (A) reaches a source-scoped rule with doc-comment firings) is not raised
  again by these three; they read under (A) as ruled, with the scope disclosed.
- **Two "missing X" names, and what the record decides.** `heading-missing-required-separator`
  (`7e3eefea`) and `command-missing-required-env-token` (`b3e3e2b3`) name an absence, as batch 3's
  `typeof-comparison-missing-null-guard` did — but here the absent thing is a literal token shape on
  the same line (a `—` / `–` / `-` separator; the token `LC_ALL=C`), which the `line`-window
  `requires:` decides syntactically and exactly, with no semantic property in the name. The
  rule-1 question the batch-3 name raised (a semantic "null guard") does not arise; disclosed so the
  review can say whether the naming convention (`<shape>-missing-<token>`) is acceptable for an
  absence construct.
- **`forbidden-object-member-call` is a new name for a shape batch 1 folded into
  `forbidden-callee-call`.** `089b0c62`'s matcher is `console.$METHOD($$$ARGS)` — the callee's
  property is a metavariable, so the class is "a call whose callee is a member of a fixed object,
  any member", not "a call to a fixed callee". Batch 1's `forbidden-callee-call` rows all name a
  FIXED callee (`console.log`, `fs.rmSync`, `String`, `import`, `expect(…).toContain`), and this
  batch's `427481b5`, `5c5fe9d9` (`console.warn`) and `63680bf3` (`process.exit`) do too. Whether the
  wildcard-member shape is the same decidable class or a distinct row is the review's call; the
  translator names it distinctly so the review decides it rather than inherits it.

## Whole-batch transformation inventory

| Transformation                                                  | Count | Rules                                                                                                                                                   |
| --------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) `!`-negation entries → `excludeGlobs`                       | 4     | `089b0c62`, `427481b5`, `61dcb058`, `63680bf3`                                                                                                          |
| (ii) must-contain lookaround → `requires:` (`line` window)      | 3     | `b34d9515` (removed 4, quoted in its note), `7e3eefea` (removed 0), `b3e3e2b3` (removed 0; the K9 shape cured at the line window); added 0 on all three |
| (iii) N-record language split / zero-coverage language dropped  | 4     | `fb008f77` (N = 2: typescript, javascript; tsx, jsx dropped), `427481b5` (tsx dropped), `d487264e` (tsx dropped), `5c5fe9d9` (javascript dropped)       |
| Inert lookaround kept verbatim                                  | 0     | —                                                                                                                                                       |
| Legacy compiled pair appended as `examples[1]`                  | 0     | — (no row of this batch carries a compiled example)                                                                                                     |
| Brace-glob expansion · shallow-glob promotion · `message` edits | 0     | —                                                                                                                                                       |
| `lessonHeading` dropped                                         | 14    | the V1 grammar has no heading construct; the heading rides the envelope's `targetDefect`                                                                |
| Legacy `manual` / `unverified` flags dropped                    | 2     | `8435c024`, `b34d9515`; the grammar has no such field                                                                                                   |

## Harness results (verbatim summary lines; full logs on the branch)

Batch 4 (`harness-run.log`, exit 0):

```
Validate: 15 record(s) — parsed 15, compiled 15, lowering-rejected 0, harness failures 0; expectation mismatches 0
Fidelity (records): 12/15 identical, 3 expected divergence(s), 0 UNEXPECTED
Fidelity (entries): 11/14 identical, 3 expected divergence(s), 0 UNEXPECTED
Differential split (measured, per entry):
  differential-satisfied   14  (entries 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53)
  good-also-fires          0
  bad-does-not-fire        0
  not-evaluable            0
Differential expectation mismatches: 0
Verdict: PASS (exit 0) — validate mismatches 0, harness throws 0, unexpected fidelity 0, differential mismatches 0
```

The three expected divergences are the three (ii) rows. Legacy-row-over-pair-0: `bad=FIRES
good=silent` on 13 rules; **`bad=FIRES good=FIRES` on `b3e3e2b3`** — the frozen matcher does not
discriminate its own curated pair (the K9 shape; the record does). Firing-set leg over the pinned
tree: `added = 0` on every entry; `removed = 0` on thirteen entries and `removed = 4` on `b34d9515`
(the four lines quoted in its note). The entry numbers in the log are manifest positions (40–53);
the log notes the 42 record files of batches 1–3 as ignored (the stacking).

K3 self-check (`k3-run.log`, exit 0) over the 22 R14 records at `78e7f196` under the same 2.10.0
staging core, `--seed seed-20.json --corpus compiled-rules.json --r14` (both inputs at the manifest's
blob ids), from this worktree: the same figures as the batch-1, batch-2 and batch-3 runs (validate 22
· 21 · 1 · 0; differential 15 · 3 · 1 · 1 with the P0 entry sets; probe 0/7, controls 1/1; fidelity
18/20 + 2 declared + 0 unexpected; REPRODUCED), and **`k3-per-record.jsonl` byte-identical to the
batch-1 pin's `operations-local/gate5/k3/k3-per-record.jsonl`** (`cmp` exit 0).

## The engine-typing census (the scorer's instrument, run by the translator)

`census-batch-4.txt` beside these notes: `class-review/census-comment-firings.mjs` at strategy
`729fa215` (run from the strategy checkout at that commit, unmodified), `--tree` the pinned tree
`5293614b`, `--manifest` the frozen manifest, `--staging` the 2.10.0 install, `--rules` the eight
regex rules of this batch. It counts RAW per-line legacy firings by the shipped AST-context
classifier, before the runtime's suppression (its own header says so). Per rule, `code · comment ·
string · other (no-grammar)`:

| Rule       | code | comment | string | other         | total | where the firings sit                                                                                   |
| ---------- | ---- | ------- | ------ | ------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `884becd4` | 0    | 0       | 0      | 9 no-grammar  | 9     | `.md` files only (contributing docs, the compiled-rules exports, two lessons)                           |
| `61dcb058` | 0    | 0       | 0      | 2 no-grammar  | 2     | the two compiled-rules exports quoting the legacy pattern                                               |
| `8435c024` | 0    | 0       | 0      | 12 no-grammar | 12    | `.md` files (the exports, two lessons, two wiki pages, …)                                               |
| `8213cd4e` | 0    | 0       | 0      | 2 no-grammar  | 2     | one export quoting the pattern; `packages/core/CHANGELOG.md:2574` (a closing keyword before three refs) |
| `b34d9515` | 1    | 0       | 1      | 15 no-grammar | 17    | code: `totem.config.ts:57` (`.junie/skills/totem-rules/rules.md`); string: `wrap.ts:61`; the rest `.md` |
| `7e3eefea` | 0    | 0       | 0      | 1 no-grammar  | 1     | `packages/pack-rust-architecture/README.md:22` (`## Lesson manifest`)                                   |
| `4ae0a01d` | 0    | 0       | 0      | 0             | 0     | —                                                                                                       |
| `b3e3e2b3` | 0    | 0       | 0      | 26 no-grammar | 26    | `.sh` files only (`.claude/hooks/*.sh`)                                                                 |

So at this tree no regex rule of this batch carries a comment-context firing; the review applies the
rule, these notes only measure it. `no-grammar` counts firing LINES (not files) in in-scope files the
classifier has no grammar for — counted, never skipped, the instrument's rule; the `.md` firings are
mostly the compiled-rules exports (`.github/copilot-instructions.md`, `.junie/skills/totem-rules/rules.md`)
quoting each lesson's own heading or pattern.

## Per-rule notes (manifest order)

Fields: the legacy row (the frozen manifest's `legacy` block and `curatedPair`), what the record
carries, the inventory items, the honest class with the census counts (regex rows), the firing set
over the pinned tree, the differential and legacy-over-pair-0 verdicts, the curator.

### 40. `884becd45e6380bd` — rank 176 — regex — `mig-884becd4-bare-pnpm-version.rule.yaml`

- Legacy: `pattern: \bpnpm\s+version\b`; globs `**/*.sh`, `**/*.bash`, `**/*.yml`, `**/*.yaml`,
  `**/Makefile`, `**/*.md`; warning. Record: pattern and globs verbatim (`**/Makefile` matches 0
  files, kept).
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed command token sequence (`pnpm version`);
  the exemplar row's shape, under (A). Census: 0 comment, 0 string, 0 code, 9 no-grammar (all `.md`).
- Firing set: 9 → 9, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 41. `089b0c628b330c16` — rank 179 — ast-grep — `mig-089b0c62-console-any-method-core.rule.yaml`

- Legacy: `astGrepPattern: console.$METHOD($$$ARGS)`; globs `packages/core/**/*.ts`, `!**/*.test.ts`,
  `!**/*.spec.ts`; warning; a duplicate-group survivor. Record: `pattern` verbatim,
  `language: typescript`, `excludeGlobs: ['**/*.test.ts', '**/*.spec.ts']`.
- Inventory: (i).
- Honest class: `forbidden-object-member-call` (ast-grep) — a call whose callee is ANY member of a
  fixed object (`console.*`); named distinctly from `forbidden-callee-call` (a fixed callee) so the
  review decides whether the wildcard-member shape is the same row (see the disclosure above). New
  pair.
- Firing set: 1 → 1, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-codex, 2026-08-22.

### 42. `427481b534fe3392` — rank 180 — ast-grep — `mig-427481b5-console-warn-core.rule.yaml`

- Legacy: `astGrepPattern: console.warn($$$ARGS)`; globs `packages/core/**/*.ts`,
  `packages/core/**/*.tsx`, `!**/*.test.ts`, `!**/*.spec.ts`; warning; a duplicate-group survivor.
  Record: `pattern` verbatim, `language: typescript`, `fileGlobs: ['packages/core/**/*.ts']` (the
  tsx glob dropped with its language: 0 files), `excludeGlobs: ['**/*.test.ts', '**/*.spec.ts']`.
  Curation observation for R8: the matcher is `5c5fe9d9`'s matcher on an overlapping scope; the two
  rules fire together on `packages/core/**/*.ts` minus the excludes — disclosed, not a translation
  matter.
- Inventory: (i), (iii).
- Honest class: `forbidden-callee-call` (ast-grep) — batch 1's PAIR, DELIVERED in
  mmnto-ai/totem#2949; carries over as deliverable, no second review here.
- Firing set: 1 → 1, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 43. `5c5fe9d9060bcb6d` — rank 181 — ast-grep — `mig-5c5fe9d9-console-warn-core-onwarn.rule.yaml`

- Legacy: `astGrepPattern: console.warn($$$ARGS)`; globs `packages/core/**/*.ts`,
  `packages/core/**/*.js`, `src/**/*.ts`, `src/**/*.js`, `lib/**/*.ts`, `lib/**/*.js`; warning.
  Record: `pattern` verbatim, `language: typescript`, `fileGlobs: ['packages/core/**/*.ts',
'src/**/*.ts', 'lib/**/*.ts']` (the three `.js` globs dropped with their language: 0 files under
  those directories; the two zero-file `.ts` globs kept as same-language globs). Curation
  observation for R8: no test exclusion on this row, so the legacy and the record fire on test files
  under `packages/core/**` where `427481b5` is silent — the one firing at this tree is the same line
  both rules count.
- Inventory: (iii).
- Honest class: `forbidden-callee-call` (ast-grep) — batch 1's PAIR, DELIVERED; carries over.
- Firing set: 1 → 1, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 44. `61dcb058bd1df15d` — rank 182 — regex — `mig-61dcb058-delete-totem-lessons-md.rule.yaml`

- Legacy: `pattern: \b(?:git\s+rm|rm)\s+[^\n]{0,40}\.totem/lessons\.md\b`; globs `**/*.sh`,
  `**/*.bash`, `**/*.zsh`, `**/*.md`, `**/*.ts`, `**/*.js`, `**/*.cjs`, `**/*.mjs`, `.claude/**/*`,
  `!**/*.test.*`, `!**/*.spec.*`, `!.totem/lessons/**`, `!.totem/lessons.md`, `!.totem/tests/**`;
  error. Record: pattern verbatim (the `(?:…)` group is not a lookaround), the nine positive globs
  verbatim (`**/*.zsh` 0 files, kept), `excludeGlobs` the five negations in positive form.
- Inventory: (i).
- Honest class: `forbidden-callee-literal-arg` (regex) — a delete command (`rm` / `git rm`) with a
  fixed path literal as its argument; batch 1's PAIR, WITHHELD on measured engine typing — carries
  over as `intake-ineligible (engine-typing)`, kept out of the envelope at the intake pin. Census
  here: 0 comment, 0 string, 0 code, 2 no-grammar (the two compiled-rules exports quoting the
  pattern) — the pair, not this count, is what the table withholds.
- Firing set: 2 → 2, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 45. `fb008f77a1f5a49a` — rank 187 — ast-grep — `mig-fb008f77-spawnsync-string-command.rule.yaml` + `-js`

- Legacy: `astGrepPattern: spawnSync($CMD, { $$$OPTS })`; globs `**/*.ts`, `**/*.js`, `**/*.tsx`,
  `**/*.jsx`; warning. Records (N = 2): `language: typescript` with `fileGlobs: ['**/*.ts']`;
  `language: javascript` with `fileGlobs: ['**/*.js']` (the `-js` twin); tsx and jsx dropped with
  their languages (0 files each). `examples[0].bad` carries a template literal with an interpolation
  and an escaped double quote — the YAML scalar is single-quoted, the round trip from the written
  file is byte-equal.
- Inventory: (iii).
- Honest class: `named-callee-argument-shape` (ast-grep) — a call to a fixed callee whose argument at
  a fixed position has a fixed node shape (an object literal where an array is expected, so the
  arguments array is absent). New pair. Both records name it (one class per rule, § 3.4).
- Firing set (entry union): 1 → 1, added 0, removed 0 (the typescript record 1, the javascript
  record 0).
- Differential satisfied on both records; legacy over pair 0 satisfied. Curator status-claude,
  2026-08-24.

### 46. `8435c024569ffa51` — rank 188 — regex — `mig-8435c024-gemini-md-lowercase.rule.yaml`

- Legacy: `pattern: \bgemini\.md\b`; globs `**/*.md`, `**/*.sh`, `**/*.yml`, `**/*.yaml`,
  `**/package.json`, `**/*.txt`; error; `manual`, `unverified`; **the `message` and the
  `lessonHeading` are both the truncated sentence `The Gemini CLI and Gemini Code Assist (GCA) do
not`** (a pre-registered `defective-source` candidate on the text, not the matcher; carried
  byte-for-byte). Record: pattern and globs verbatim.
- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed literal (the lowercase file name); the
  exemplar row's shape, under (A). Census: 0 comment, 0 string, 0 code, 12 no-grammar (`.md` files:
  the exports, two lessons, two wiki pages).
- Firing set: 12 → 12, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 47. `8213cd4e21b375ba` — rank 189 — regex — `mig-8213cd4e-closes-keyword-issue-list.rule.yaml`

- Legacy: `pattern: \b(?:[Cc]loses?|[Cc]losed|[Ff]ix(?:es|ed)?|[Rr]esolves?|[Rr]esolved)\s+#\d+\s*,\s*#\d+`;
  globs `**/CHANGELOG.md`, `.github/**/*.md`, `.changeset/*.md`; warning. Record: pattern and globs
  verbatim (the `(?:…)` groups are not lookarounds).
- Inventory: none.
- Honest class: `close-keyword-issue-list` (regex) — a GitHub closing keyword followed by a
  comma-separated list of issue references (the keyword binds only the first). New pair. Census: 0
  comment, 0 string, 0 code, 2 no-grammar (one export quoting the pattern;
  `packages/core/CHANGELOG.md:2574`, a real instance of the shape).
- Firing set: 2 → 2, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator totem-claude, 2026-08-24 (the
  translator seat).

### 48. `b34d95158d37f5a9` — rank 191 — regex — `mig-b34d9515-junie-file-location.rule.yaml`

- Legacy: `pattern: \.junie\/(?!mcp\/mcp\.json|guidelines\.md)[^'"\s>]+\.(json|md)`; globs
  `**/*.js`, `**/*.ts`, `**/*.json`, `**/*.md`, `**/*.sh`, `**/*.yml`, `**/*.yaml`,
  `**/.gitignore`; warning; `manual`, `unverified`; **the `message` (and heading) is the truncated
  `Junie requires specific file locations for auto-detection,`** (carried byte-for-byte). Record:
  `pattern: \.junie\/[^'"\s>]+\.(json|md)` (the legacy pattern less its one lookahead) +
  `requires: { pattern: 'mcp\/mcp\.json|guidelines\.md', scope: line }` (the lookahead's body
  verbatim — an alternation, kept whole); globs verbatim.
- Inventory: **(ii)**. Measured over the pinned tree: **removed 4, added 0** (17 → 13). The four
  lines, verbatim from `5293614b` (the legacy fires on `.junie/AGENTS.md`, a `.md` under `.junie/`
  outside its allow-list; the record is silent because an allowed name — `guidelines.md` or
  `mcp/mcp.json` — sits on the same line):

  ```text
  .github/copilot-instructions.md:670   \*\*Junie:\*\* Uses .junie/guidelines.md or .junie/AGENTS.md for instructions (project only, loaded into every prompt). MCP config at .junie/mcp/mcp.json (NOT .mcp.json). …
  .junie/skills/totem-rules/rules.md:670   (the same exported line)
  .totem/lessons/lesson-2de13dca.md:15   **Junie:** Uses .junie/guidelines.md or .junie/AGENTS.md for instructions (project only, loaded into every prompt). MCP config at .junie/mcp/mcp.json (NOT .mcp.json). …
  docs/wiki/agent-jetbrains-junie.md:7   - **Project Context:** `.junie/guidelines.md` (or `.junie/AGENTS.md`). Instructions loaded into every prompt. …
  ```

  Curation feedback for R8, two items: the legacy allow-list omits `.junie/AGENTS.md`, which the
  repository's own Junie page names as the alternative instructions file, so these four are legacy
  false positives under the lesson's intent and the `window-widened` covariate removes only those;
  and the one code-context firing at this tree, `totem.config.ts:57`
  (`junie: '.junie/skills/totem-rules/rules.md'`), is totem's own skills export path, which the
  lesson's allow-list also omits (the record keeps that firing: no allowed name on the line).

- Honest class: `forbidden-path-literal` (regex) — a path literal under a fixed directory outside a
  fixed allow-list; batch 1's PAIR, WITHHELD on measured engine typing — carries over as
  `intake-ineligible (engine-typing)`, kept out of the envelope at the intake pin. Census here: 0
  comment, 1 string (`packages/cli/src/commands/wrap.ts:61`), 1 code (`totem.config.ts:57`), 15
  no-grammar.
- Firing set: 17 → 13, added 0, removed 4 (above).
- Differential satisfied (pair 0: `bad` `cp config.json .junie/config.json` fires; `good`
  `cp config.json .junie/mcp/mcp.json` — the target matches without the lookahead and the
  requirement on the line suppresses it); legacy over pair 0 satisfied. Curator totem-claude,
  2026-08-24 (the translator seat).

### 49. `7e3eefeaa85403d0` — rank 192 — regex — `mig-7e3eefea-lesson-heading-separator.rule.yaml`

- Legacy: `pattern: ^## Lesson(?! [—–-] .+)`; globs `**/*.md`; warning. Record: `pattern: ^## Lesson`
  - `requires: { pattern: ' [—–-] .+', scope: line }` (the lookahead's body verbatim: a space, one of
    em dash / en dash / hyphen, a space, one or more characters; the two dashes are literal characters
    in the YAML, single-quoted for the leading space); glob verbatim.
- Inventory: **(ii)**. Measured over the pinned tree: removed 0, added 0 (1 → 1): the one legacy
  firing, `packages/pack-rust-architecture/README.md:22` (`## Lesson manifest`), carries no
  separator anywhere on its line, so the line window changes nothing at this tree. The widening the
  window admits, stated: a `## Lesson` heading whose separator appears later on the line but not
  immediately after `Lesson` (`## Lesson: foo - bar`) is a legacy firing the record suppresses.
- Honest class: `heading-missing-required-separator` (regex) — a fixed heading prefix lacking a
  required separator token on its line (an absence the `line`-window `requires:` decides). New pair;
  see the "missing X" disclosure. Census: 0 comment, 0 string, 0 code, 1 no-grammar.
- Firing set: 1 → 1, added 0, removed 0.
- Differential satisfied (pair 0: `## Lesson: Missing separator heading` fires; `## Lesson — Proper
separator heading` carries `—` and is suppressed); legacy over pair 0 satisfied. Curator
  totem-claude, 2026-08-24 (the translator seat).

### 50. `d487264e210913a4` — rank 193 — ast-grep — `mig-d487264e-try-expect-fail-catch.rule.yaml`

- Legacy: `astGrepPattern: try { $$$PRE; expect.fail($$$ARGS); $$$POST } catch ($ERR) { $$$CATCH }`;
  globs `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`; warning. Record: `pattern`
  verbatim, `language: typescript`, `fileGlobs: ['**/*.test.ts', '**/*.spec.ts']` (the two tsx globs
  dropped with their language, 0 files; `**/*.spec.ts`, 0 files, kept as a same-language glob).
- Inventory: (iii).
- Honest class: `try-block-expect-fail-with-catch` (ast-grep) — a try statement whose block contains
  an `expect.fail(…)` call and whose catch clause is present (the assertion-in-catch form). New pair.
- Firing set: 5 → 5, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator status-claude, 2026-08-24.

### 51. `4ae0a01d912f8742` — rank 196 — regex — `mig-4ae0a01d-bare-totem-extract-alias.rule.yaml`

- Legacy pattern (quoted in a fence because it begins with a backtick), glob `docs/wiki/**/*.md`,
  warning:

  ```text
  `totem\s+extract\b
  ```

  Record: pattern and glob verbatim (the YAML scalar is quoted by the writer; the parse yields the
  legacy string byte-for-byte, the fidelity leg's witness).

- Inventory: none.
- Honest class: `forbidden-literal-token` (regex) — a fixed command alias in a code span; the
  exemplar row's shape, under (A); prose-only scope. Census: 0 firings of any context at this tree
  (36 in-scope files).
- Firing set: 0 → 0, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 52. `63680bf329d59167` — rank 197 — ast-grep — `mig-63680bf3-process-exit-cli.rule.yaml`

- Legacy: `astGrepPattern: process.exit($CODE)`; globs `packages/cli/src/**/*.ts`,
  `!packages/cli/src/index.ts`, `!packages/cli/src/commands/**/*.ts`, `!**/*.test.ts`,
  `!**/*.test.tsx`, `!**/*.spec.ts`, `!**/*.spec.tsx`; warning. Record: `pattern` verbatim,
  `language: typescript`, `fileGlobs: ['packages/cli/src/**/*.ts']`, `excludeGlobs` the six negations
  in positive form (the two tsx excludes are zero-file excludes on a typescript record, kept
  verbatim; the parser and the scope leg accept them). Curation observation for R8: the matcher is
  batch 2's `240f19ca` matcher on a narrower scope with two path exclusions — the two rules fire
  together on the same lines under `packages/cli/src/**` minus the excludes.
- Inventory: (i).
- Honest class: `forbidden-callee-call` (ast-grep) — batch 1's PAIR, DELIVERED; carries over.
- Firing set: 2 → 2, added 0, removed 0.
- Differential satisfied; legacy over pair 0 satisfied. Curator strategy-kimi, 2026-08-23.

### 53. `b3e3e2b380a0b1be` — rank 198 — regex — `mig-b3e3e2b3-git-lc-all.rule.yaml` (the § Design 8 exemplar-pair rule)

- Legacy: `pattern: \bgit\s+(?!.*LC_ALL=C)`; globs `**/*.sh`, `**/*.bash`; warning; the
  `lessonHeading` is the truncated `Git output can vary by system locale, causing parsing logic`;
  `sourceRefCites: exemplar` — the curated pair is the text strategy-claude (the scorer) wrote on
  2026-08-19 as Prop 310 § Design 8's exemplar, and the manifest row's receipt says the pair
  "verifies only under the § Design 8 requires form". Record: `pattern: \bgit\s+` (the legacy
  pattern less its one lookahead) + `requires: { pattern: 'LC_ALL=C', scope: line }` (the
  lookahead's body less its `.*` window prefix — R14's `5da43ea6` mechanics); globs verbatim.
- Inventory: **(ii)**. Measured over the pinned tree: removed 0, added 0 (26 → 26): every `git `
  invocation in the nine in-scope shell files lacks `LC_ALL=C` on its line, so the lookahead and the
  line window agree on all 26.
- **The K9 shape, disclosed:** the frozen legacy matcher fires on the curated `good`
  (`LC_ALL=C git log --oneline`: after `git ` the rest of the line carries no `LC_ALL=C`, so the
  lookahead passes) — the harness's legacy-over-pair-0 leg reports `bad=FIRES good=FIRES`, the
  pre-registration's standing `defective-source` case and the scorer's control K9. The record
  discriminates the pair: `bad` fires (no `LC_ALL=C` on the line); `good` is suppressed (`LC_ALL=C`
  on the line) — the cure the `defective-source` paragraph names ("a `requires:` translation under
  C3 may cure it, in which case no miss stands"). Whether a miss stands is the scorer's typing, not
  the translator's. **D3 (ii):** the whole entry's rows of record — C0 through C7 and the admission
  column — are the blind replayer's (strategy-codex) under the frozen `score.mjs`, the scorer's
  beside, verdict-inert; R7 names it. The translator's part is the record and this class name only.
- Honest class: `command-missing-required-env-token` (regex) — a fixed command invocation whose line
  lacks a required literal token (`LC_ALL=C`), an absence the `line`-window `requires:` decides. New
  pair; see the "missing X" disclosure. Census: 0 comment, 0 string, 0 code, 26 no-grammar (all
  `.sh` under `.claude/hooks/`).
- Firing set: 26 → 26, added 0, removed 0.
- Differential satisfied (the record); legacy over pair 0 NOT satisfied (`good=FIRES`, above).
  Curator totem-claude, 2026-08-24 (the translator seat; the pair's text is the scorer's).

## The envelope (`.totem/spine/authored-rules.yaml`)

The shared envelope with **15 entries appended** (57 in all); the header unchanged
(`splitRef: gate5-migration-2263305c`, `authoredAfterSplit: true`, `heldOutNonInspectionAttestation:
true`); the 42 entries of batches 1–3 byte-identical (the generator asserted the old file a byte
prefix of the new one before writing). One entry per batch-4 record: `author: totem-claude` ·
`authoredAt: '2026-09-23'` · `targetDefect: "<lessonHash16>[@<language>]: <targetDefectText>"` (the
manifest's text; the N = 2 set carries `@typescript` and `@javascript`) · `structuralClass` = the
honest class above · `record: .totem/rules/<file>` · `positiveFixtures: [{pr: 2950, filePath: <the
record>, matchedSpan: examples[0].bad, contentHash: sha256(examples[0].bad), example: 0}]` — this
batch's draft PR is mmnto-ai/totem#2950. The `(author, targetDefect)` identity was checked unique
over the whole file (all four batches) before the write.

**Records kept out of the envelope:** none — all 15 parse and lower. **Records the pre-pin intake
pass rejects:** every entry whose honest class is outside the five pre-release rows — expected at
this pass (§ 5 step 2) and not a fault. **Entries the pass ADMITS:** the three
`forbidden-literal-token` rows of this batch (`884becd4`, `8435c024`, `4ae0a01d`) — the exemplar
row, under the operator's (A): admission measured at the intake pin, flagged on R6 — and, in the
shared file, batches 1–3's six again (the clone has no ledger row from their own passes). **At the
intake pin, under the scorer's batch-1 table and delivery:** `61dcb058` and `b34d9515` read
`intake-ineligible (engine-typing)` by carry-over and are kept out of the envelope there (the
generator's `--exclude`), with batch 1's three withheld rules, batch 2's `2d3ac4b9` and batch 3's
`434c51ff` and `0615c43e` below them in the stack; `427481b5`, `5c5fe9d9` and `63680bf3` become
admissible under the delivered `(ast-grep, forbidden-callee-call)` row once the `@mmnto/cli` patch
carrying mmnto-ai/totem#2949's rows is published and the intake runs at that version.

## Pre-pin pass (§ 3.3) — scratch clone, published 2.10.0

Run 2026-09-24 in a scratch clone of the branch at `23d2008883f6d3f684e624ba553c645323d90e86` (the
envelope commit; `git clone --branch gate5/batch-4-2263305c --single-branch`, HEAD checked equal to
the pushed commit), never the branch checkout; the nine ledger rows the pass wrote stayed in the
clone and are not on the branch. Both legs used the staging install of the PUBLISHED 2.10.0. The
logs are on the branch as `prepin-validate.log` and `prepin-intake.log` beside these notes; the
clone commit, both invocations and both exit codes are attested in `prepin-run.txt` beside them
(the captured logs carry no header of their own).

**Coverage limit of the pass, disclosed (as batches 1–3 disclosed it):** a whitelist miss returns
before `deriveRecordFixtures` and the record-schema parse of the entry, so on the 48 rejected entries
the dangling-ordinal and `failed validation` throws were not reached by the intake itself; they are
reached for every entry only at the post-release intake pin. The record parse, the `judgedBy ==
author` check and the `(author, targetDefect)` identity check run over the whole file before any
entry is judged and all passed.

**Validate leg** — the generalized harness in the clone, no `--tree`: exit 0; the summary lines
identical to the batch run's (15 parsed, 15 compiled, fidelity 12/15 + 3 declared, differential
14/14, `Verdict: PASS (exit 0)`; `legacy/pair0: bad=FIRES good=FIRES` on `b3e3e2b3` as in the batch
run). Invocation in `prepin-run.txt`; the full log in `prepin-validate.log`.

**Intake** — `TOTEM_NO_REEXEC=1 node <staging>/node_modules/@mmnto/cli/dist/index.js rule author`
(cwd = the clone root; the CLI default `judgedBy` at this PRE-release pass). Exit 1 — the expected
outcome (§ 5 step 2): no file-aborting throw; **9 minted** (the exemplar row: batches 1–3's six,
this batch's three) and **48 rejected** per record on the whitelist (batch 1's 13, batch 2's 14,
batch 3's 9, this batch's 12 — the N = 2 set counted twice), each naming its `(engine, class)` pair.
The minted block verbatim (the 48 rejected lines in `prepin-intake.log`):

```text
[RuleAuthor] 9 authored rule(s): 9 minted, 0 revised, 0 unchanged.
  + 923841006dd9c024  totem-claude :: 6ad0d4d5c760a5d6: Technical documentation must avoid marketing-centric terms
  + 6e5b15c0ae7e2285  totem-claude :: 5afaf8d03f059a41: Emojis are excluded from all documentation files to adhere
  + f4538a6aa67863a3  totem-claude :: 391de7088c633579: 2026-03-03T01:52:20.000Z
  + 53926c1a10b531b9  totem-claude :: 87e2437431c17ec5: Git diff headers wrap file paths containing spaces
  + d6da524c3aec39c7  totem-claude :: 55797450514d4c3b: Never use git add -A or git add .
  + 1c3a3c4e61a2d666  totem-claude :: 56c801dfda484c75: The text-embedding-004 identifier is frequently unavailable
  + 106680a4d371f82f  totem-claude :: 884becd45e6380bd: Using 'pnpm run version' instead of the bare 'pnpm version'
  + 50662ab6a745c6d5  totem-claude :: 8435c024569ffa51: The Gemini CLI and Gemini Code Assist (GCA) do not
  + 312894688c167fb2  totem-claude :: 4ae0a01d912f8742: Use canonical CLI command forms

[RuleAuthor] WARNING: 48 rule(s) REJECTED — not structurally decidable, excluded from the producer output:
```

The eleven batch-4 `intake-ineligible (whitelist)` outcomes at this pass (twelve rejected lines, the
N = 2 set counted twice) are this batch's D1 (C) demand figure before carry-over is applied: two of
them (`61dcb058`, `b34d9515`) are batch-1 pairs already withheld; three (`427481b5`, `5c5fe9d9`,
`63680bf3`) are the batch-1 pair already delivered and need no review; six are new pairs for the
review; the class list is in the pin mail and in the per-rule notes above.

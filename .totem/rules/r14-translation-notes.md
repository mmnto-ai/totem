# R14 trial — seed-20 translation notes

Prop 310 § Design 15 step 3. Twenty legacy compiled rules, drawn in seed order, translated into
V1 rule records under `.totem/rules/`. **Drafted by a bounded build leg; the registered translator
reviews every record.** Translator ≠ scorer (§ Design 15 step 3): nothing below types a miss — each
entry flags CANDIDATES with grounds, and the scorer types them.

## Method

- **Source of truth:** the frozen seed-20 compiled forms (`lessonHash`, `engine`, `severity`,
  `message`, `pattern` / `astGrepPattern` / `astGrepYamlRule`, `fileGlobs`).
- **Fidelity rule applied:** translate the rule's EFFECTIVE semantics as the shipped sanitizer
  evaluated them, then express them grammar-natively. Where the two pull apart, fidelity wins and
  the divergence is recorded here rather than engineered away.
- **Grammar authority:** the shipped `packages/core/src/spine/rule-record.ts` (parser, § Design 7
  strict dialect) + `record-lower.ts` (lowering, § Design 6 language resolution and the
  language⇄glob floor). Both are spec-normative implementations per § Design 14.
- **Harness:** `operations-local/r14-validate.mjs` runs the real `parseRuleRecord` then
  `compileRuleRecord(parsed, {ruleId: '0123456789abcdef', now: '2026-08-22T00:00:00.000Z'})`.
  The `ruleId` is SYNTHETIC and harness-only — identity is producer-owned (§ Design 3 / R17) and is
  minted at the ADR-112 intake seam, which this trial does not run.
- **Differential harness:** `operations-local/r14-differential.mjs` runs each record's
  `examples.bad` and `examples.good` through the shipped matchers (`new RegExp(rule.pattern)` per
  line, as `rule-engine.ts:659` does; `matchAstGrepPattern` at `.ts` for ast-grep), classifies every
  record into the four § Design 15 step 4 outcomes, and carries the entry-17 dead-matcher probe with
  its two isolating controls. Results are reported per rule below under **differential**. It is
  committed alongside the validate script so every measured claim in these notes is REPLAYABLE at
  this SHA: it derives the repo root from its own module URL, reads nothing outside the tree, uses
  no clock or randomness, and exits non-zero if the measurement stops matching the verdict recorded
  here. Verbatim output at § Replay below.
- **Fidelity leg (optional, needs the frozen seed artifact):** the same script accepts
  `--seed <path>` to the frozen seed-20 JSON and compares each parsed record's `severity` /
  `message` / payload against it. Measured: 19 of 20 identical to seed, 0 unexpected divergences —
  the only payload divergence across all 20 is the deliberate absence→`requires` transformation on
  `5da43ea60b66e96e`. The seed JSON lives outside the repo, so this leg is gated behind the flag and
  the two legs above stand without it.

## Whole-seed transformation inventory

| Transformation                                                             | Count | Rules                                                                  |
| -------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `!`-negation entries → `excludeGlobs` (positive form)                      | 6     | `87aff037`, `54140f59`, `5b85fe53`, `6467c351`, `65ede9bf`, `0167a783` |
| Language narrowing (dominant-language record; other-grammar globs dropped) | 5     | `aa7a588d`, `6b1890e2`, `6b2b62eb`, `d940b2c9`, `71935fe9`             |
| Absence (lookahead-as-must-contain) → `requires:`                          | 1     | `5da43ea6`                                                             |
| Compiled `astGrepYamlRule` config-form unwrapped to `target.rule` TREE     | 1     | `87aff037`                                                             |
| Brace-glob expansion                                                       | 0     | — (no seed rule carries a brace glob)                                  |
| Shallow-glob promotion made explicit (`*.ts` → `**/*.ts`)                  | 0     | — (every seed glob is already tree-form or directory-anchored)         |
| `message` reconstruction from the pattern                                  | 0     | — (both timestamp-heading rules carry real `message` content)          |
| `lessonHeading` dropped                                                    | 20    | the V1 grammar has no heading construct                                |

**Language narrowing, grounds.** `record-lower.ts`'s `checkLanguageGlobConsistency` is a ruled floor:
for `type: ast-grep`, EVERY `target.scope.fileGlobs` entry must end in a registered extension that
resolves to the single declared `target.language`. The shipped registry
(`ast-classifier.ts:347-362`) registers exactly three languages: `typescript` (`.ts`, `.mts`,
`.cts`), `tsx` (`.tsx`, `.jsx`), `javascript` (`.js`, `.mjs`, `.cjs`). A legacy rule globbing
`**/*.ts` + `**/*.tsx` + `**/*.js` therefore spans three languages and cannot be one record —
§ Design 6's options row says so directly ("a multi-language ast-grep rule is N records"). Each such
rule was translated as the DOMINANT-language record: `typescript`, which covers the plurality of
this repo's realistic targets (a Node CLI monorepo with no `.tsx`/`.jsx` sources). `excludeGlobs`
are exempt from the floor and were carried verbatim.

**Every record carries `curation.sourceLesson: "lesson-<lessonHash>"` and nothing else** — the
`sourceLesson`-alone shape legalized by the operator ruling 2026-08-21
(`rule-record.ts:661-710`). No producer keys, no `id`, no `declaredEngine`, no Baseline-5 process
trio (these are direct translations, not curations).

## Harness result

```
Summary: 20 record(s) — parsed 20, compiled 19, lowering-rejected 1, harness failures 0
```

Exit 0. The one lowering rejection is `1a7080ebf6162de3` (below), recorded verbatim rather than
reworked: fidelity beats compilability, and a faithful record that rejects is trial data.

---

## Per-rule notes (seed order)

### 1. `d5faa14cbb8b50fb` — absolute claims in technical documentation

- **Target:** `.totem/rules/r14-d5faa14c-absolute-claims-in-docs.rule.yaml`
- **Transformations:** none beyond carriage. `engine: regex` → `target.type: regex` (no `language`,
  which the grammar forbids for regex). `severity: warning` and `message` verbatim. All four globs
  (`**/*.md`, `**/*.mdx`, `**/*.rst`, `**/*.txt`) carried verbatim — dialect-clean, and regex scopes
  are not subject to the language floor.
- **`examples`:** authored fresh (the legacy rule records no positives). `bad` fires on
  `guarantees` and `complete`; `good` is free of every banned token.
- **Harness:** parses OK, lowers OK (`engine=regex`, 4 globs).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** none.

### 2. `aa7a588d48e74503` — async test callbacks

- **Target:** `.totem/rules/r14-aa7a588d-async-test-callbacks.rule.yaml`
- **Transformations:** flat `astGrepPattern` → `target.pattern` verbatim. **Language narrowing:**
  declared `language: typescript`; dropped `**/*.test.tsx` and `**/*.spec.tsx` (both resolve to the
  `tsx` grammar, not `typescript`). Kept `**/*.test.ts`, `**/*.spec.ts`.
- **`examples`:** authored fresh; `bad` is the async arrow form, `good` the sync form.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 2 globs).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** `scope-narrowing` — the record's effective scope covers `.test.ts`/`.spec.ts`
  only; the legacy rule also covered `.test.tsx`/`.spec.tsx`. Realistic loss in this repo is zero
  (no `.tsx` test files exist), but the narrowing is real and is not silent.

### 3. `87aff037d7de47a7` — fail-open catch ban

- **Target:** `.totem/rules/r14-87aff037-fail-open-catch-ban.rule.yaml`
- **Transformations:** compiled `astGrepYamlRule` is config-form `{rule: {...}}`; the record's
  `target.rule` carries the TREE (top-level `rule` key unwrapped), per the operator ruling
  2026-08-21 recorded in `record-lower.ts`'s header — the lowering re-derives the NapiConfig
  wrapper. **`!`-negation → `excludeGlobs`:** `!**/*.test.ts` and `!**/*.spec.ts` became
  positive-form `excludeGlobs` entries; `packages/**/*.ts` stays the sole `fileGlobs` entry.
  `severity: error` and the two-paragraph `message` verbatim (block scalar, the blank-line break
  preserved).
- **`examples`:** authored fresh; identical in substance to § Design 4's own exemplar pair, which is
  this rule (the census's rule (a)).
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob / 2 excludes).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** none.

### 4. `0e01112d5f18ffde` — bare `new Error(`

- **Target:** `.totem/rules/r14-0e01112d-bare-new-error.rule.yaml`
- **Transformations:** pattern carried VERBATIM including its `(?!Totem)` lookahead. **Deliberately
  NOT translated to `requires:`** — § Design 8's `requires:` is a scoped must-contain (fire iff the
  required context is ABSENT within `line`/`file`), whereas this lookahead is a position-local
  next-token exclusion. Translating it as `requires: {pattern: 'Totem', scope: line}` would suppress
  the rule on any line mentioning "Totem" anywhere, which is a different rule. All four globs carried
  verbatim (regex, unchecked by the language floor).
- **`examples`:** `bad` = `throw new Error(...)`; `good` = `throw new TotemParseError(...)`, the
  repo's real error surface (`packages/core/src/errors.ts`).
- **Harness:** parses OK, lowers OK (`engine=regex`, 4 globs).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `defective-source` — two independent grounds. (i) The `(?!Totem)` lookahead is provably INERT:
    it sits immediately before the literal `Error\(`, so the only text that could fail the lookahead
    (`Totem…`) is text `Error\(` could never match anyway. The rule's effective semantics are exactly
    `\bnew\s+Error\(`. (ii) `message` is a truncated sentence fragment identical to the lesson
    heading ("When wrapping external errors or providing fallbacks,") and states no ban — it is not
    a usable diagnostic. The seed also marks this rule `unverified: true`.

### 5. `54140f59be3e6e44` — bare short-form issue references

- **Target:** `.totem/rules/r14-54140f59-bare-issue-number-refs.rule.yaml`
- **Transformations:** **`!`-negation → `excludeGlobs`:** `!**/*.test.ts` became a positive-form
  `excludeGlobs` entry. `fileGlobs` keeps both positives (`packages/cli/**/*.ts`,
  `apps/cli/**/*.ts`). Pattern and `severity: error` verbatim.
- **`examples`:** `bad` = a bare short-form issue reference inside a help string; `good` = the same
  reference repo-qualified as `mmnto-ai/totem#2655`, which is silent because the character preceding
  the `#` then falls inside the pattern's excluded class.
- **Harness:** parses OK, lowers OK (`engine=regex`, 2 globs / 1 exclude).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `defective-source` — `message` is a truncated sentence fragment identical to the lesson heading
    ("Issue numbers are only unique within a single repository;") and states no remedy, at
    `severity: error`. The seed marks the rule `unverified: true`.

### 6. `6b1890e2dbda3331` — empty string in branch whitelists

- **Target:** `.totem/rules/r14-6b1890e2-empty-string-in-whitelist.rule.yaml`
- **Transformations:** flat pattern verbatim. **Language narrowing:** declared
  `language: typescript`; dropped `**/*.js` (javascript), `**/*.tsx` and `**/*.jsx` (tsx). Kept
  `**/*.ts`.
- **`examples`:** authored fresh. Double-quoted string literals deliberately — the pattern's empty
  string is written `""`, and ast-grep compares terminal node text, so a `''` literal would not
  match.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `scope-narrowing` — three of four legacy globs dropped (`**/*.js`, `**/*.tsx`, `**/*.jsx`).
  - Secondary observation for the scorer, NOT flagged as a miss: the matcher is quote-style
    sensitive (`""` only), so the legacy rule already missed `''` empty strings inside its own scope.

### 7. `5b85fe53468964e1` — `emit('suppress', …)` for runtime failures

- **Target:** `.totem/rules/r14-5b85fe53-suppress-event-runtime-failure.rule.yaml`
- **Transformations:** flat pattern verbatim. **`!`-negation → `excludeGlobs`:** `!**/*.test.*` and
  `!**/*.spec.*` became positive-form `excludeGlobs` entries (both are dialect-clean — `*` is a
  single-segment wildcard and neither entry nests a globstar inside a segment). `fileGlobs` keeps
  `packages/core/**/*.ts` → `language: typescript`. No narrowing needed.
- **`examples`:** `bad` = the banned `emit('suppress', …)`; `good` routes the runtime failure through
  `onRuleEvent('error', …)`, the real Totem event API named in the seed's own `archivedReason`.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob / 2 excludes).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `defective-source` — the seed carries `status: archived` with `archivedReason` "Hallucinated API
    surface … `emit()` … has zero coverage in the codebase"; Totem's event API is
    `onRuleEvent('suppress', …)`. The record is a faithful translation of a rule whose matcher
    targets an API that does not exist here.

### 8. `6467c35159c1504d` — dynamic imports outside CLI command entry points

- **Target:** `.totem/rules/r14-6467c351-dynamic-import-cli-entry.rule.yaml`
- **Transformations:** flat pattern `import($MODULE)` verbatim. **`!`-negation → `excludeGlobs`:**
  all three negations (`!packages/cli/src/commands/**/*.ts`, `!**/*.test.ts`, `!**/*.spec.ts`)
  became positive-form `excludeGlobs`; `packages/cli/src/**/*.ts` is the sole positive →
  `language: typescript`.
- **`examples`:** `bad` = `await import('./banner.js')`; `good` = the static import.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob / 3 excludes).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `defective-source` — the seed carries `status: archived` with `archivedReason`: the glob pair is
    over-broad, matching `packages/cli/src/index.ts` and `index-lite.ts`, which is exactly where
    ADR-072 §3 places lazy command loads, so the rule fires on the canonical form it exists to
    protect. The record reproduces that scope faithfully, defect included.
  - Note for the scorer: this rule is one of THREE seed entries (`6467c351`, `65ede9bf`, `0167a783`)
    with the identical payload and identical globs, differing only in `message`. All three were
    translated; the near-duplication is the seed's, not the translation's.

### 9. `65ede9bfdf6995fe` — dynamic imports must live in CLI command handlers

- **Target:** `.totem/rules/r14-65ede9bf-dynamic-import-command-handlers.rule.yaml`
- **Transformations:** identical to entry 8 (same payload, same globs, three negations →
  `excludeGlobs`, `language: typescript`). `message` verbatim and distinct.
- **`examples`:** authored fresh and distinct from entry 8's, so the two records do not share a
  certification preimage.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob / 3 excludes).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** `defective-source` — same archived over-broad-glob ground as entry 8 (same
  `archivedReason` text in the seed).

### 10. `b973609688ec2888` — orchestrator test timeouts

- **Target:** `.totem/rules/r14-b9736096-orchestrator-test-timeout.rule.yaml`
- **Transformations:** flat pattern verbatim; single glob `packages/cli/**/*.test.ts` →
  `language: typescript`, no narrowing, no negations.
- **`examples`:** `bad` = the two-argument `describe(title, fn)`; `good` = vitest's three-argument
  options form `describe(title, { timeout: 15000 }, fn)`, which the two-argument pattern cannot
  match. This is the form the `message` itself names.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** none. Observation for the scorer, not a flag: the matcher fires on EVERY
  two-argument `describe` in CLI test files, so its precision is scope-wide by construction — that is
  the legacy rule's design, faithfully carried.

### 11. `6b2b62eb1e8693fc` — `log.error` must carry the 'Totem Error' tag

- **Target:** `.totem/rules/r14-6b2b62eb-totem-error-log-tag.rule.yaml`
- **Transformations:** flat pattern `log.error($$$ARGS)` verbatim. **Language narrowing:** declared
  `language: typescript`; dropped `**/*.tsx` (tsx) and `**/*.js` (javascript). Kept `**/*.ts`.
- **`examples`:** `bad` = an untagged `log.error(...)`; `good` = the repo's real corrected form
  `log.error('Totem Error', ...)` (the idiom at `packages/cli/src/commands/add-lesson.ts:85` and
  `packages/cli/src/index.ts:1283`).
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** bad FIRES, **good ALSO FIRES** — measured, not inferred.
- **Candidate flags:**
  - `construct-gap` — the rule's stated semantics are must-contain over the call's ARGUMENTS ("must
    include the 'Totem Error' tag"), and the compiled flat pattern encodes none of it: it fires on
    every `log.error(...)`. The construct that would express it is an ast-grep `constraints:` block
    binding a regex to `$$$ARGS`, which V1 makes INEXPRESSIBLE by name
    (`record-lower.ts: V1_INEXPRESSIBLE_NAPI_KEYS = ['constraints', 'utils']`). § Design 8's
    `requires:` is not a substitute: `requires.scope: line` is REJECTED on ast-grep targets by the
    shipped lowering, and `scope: file` would suppress the rule wherever the tag appears anywhere in
    the file.
  - `scope-narrowing` — two of three legacy globs dropped (`**/*.tsx`, `**/*.js`).
  - Honesty note: the `good` leg was authored as the genuine corrected form rather than as some
    unrelated silent snippet. Under this rule as compiled, NO tag-bearing `log.error` call can be
    silent, so § Design 15 step 4's "fires on positives ∧ silent on negatives" differential is
    UNSATISFIABLE here. Faking a silent `good` would have hidden exactly the datum the trial wants.

### 12. `1a7080ebf6162de3` — inline secrets in agent config files

- **Target:** `.totem/rules/r14-1a7080eb-inline-secrets-agent-config.rule.yaml`
- **Transformations:** flat pattern and all four globs (`**/.mcp.json`, `**/.gemini/settings.json`,
  `**/mcp*.json`, `**/.cursor/mcp.json`) carried verbatim; `language: json` declared, because that is
  what the rule's scope actually is. No registered-language subset of these globs exists — the
  shipped registry registers `typescript`, `tsx`, `javascript` and nothing else — so there was no
  narrower faithful scope to fall back to.
- **`examples`:** `bad` = an MCP server block with a literal token in `env`; `good` = the same block
  with the `env` mapping removed, which is the remedy the `message` itself prescribes ("MCP servers
  inherit env vars from the shell automatically").
- **Harness:** parses OK, **lowering REJECTED.** Reason, verbatim:

  > Prop 310 § Design 6: target.language 'json' is not registered — the resolution authority is the
  > Map-backed extensionToLanguage registry (built-ins + pack contributions), never a spec-frozen
  > enum. Registered languages: javascript, tsx, typescript. Install the pack that provides this
  > language, or correct the record.

- **Differential:** not evaluable (no compiled rule).
- **Candidate flags:**
  - `out-of-scope` — the record grammar cannot express an ast-grep rule over `.json`, because the
    engine has no Tree-sitter registration for it. This is a language-support gap
    (upstream-feedback 017's three-layer class), not a grammar-construct gap.
  - `defective-source` — the seed carries `status: archived` with `archivedReason` naming EXACTLY
    this: "engine ast-grep with all-.json fileGlobs, but no Tree-sitter language registration exists
    for .json — the rule can never execute and instead aborts lint at first contact." The record
    grammar surfaces at COMPILE what the legacy path surfaced as a runtime abort — arguably the V1
    grammar behaving correctly on a broken rule.
  - `payload-gap` (secondary, independent of the language question) — the payload shape
    `{ $$$BEFORE, "env": { … }, $$$AFTER }` is the same dead shape empirically demonstrated under
    entry 17: a bare-brace object pattern with a leading `$$$` metavariable matches nothing through
    the shipped ast-grep path. So even with a JSON grammar registered, this matcher would very
    likely stay silent.

### 13. `5da43ea60b66e96e` — git `--` separator before positional arguments

- **Target:** `.totem/rules/r14-5da43ea6-git-double-dash-separator.rule.yaml`
- **Transformations:**
  - **Absence → `requires:` (the one such transformation in the seed).** The legacy pattern smuggles
    a must-contain into `(?!.*\s--\s)`. The record drops the lookahead from `target.pattern` and
    declares `requires: {pattern: '\s--\s', scope: line}` — § Design 8's construct, which fires on a
    target match only where the required context is ABSENT. `scope: line` is legal here because the
    target is `type: regex` (the shipped lowering rejects `scope: line` on ast-grep targets).
  - **Semantic delta, stated precisely:** the lookahead searched for `\s--\s` only in the text
    AFTER the matched git verb; `requires.scope: line` searches the WHOLE line containing the match.
    The requirement window therefore WIDENS slightly, which makes the record marginally LESS likely
    to fire than the legacy rule (a `--` appearing before the git verb on the same line now
    suppresses). No firing case is added.
  - This is one of the two timestamp-heading rules. `message` is real content and was carried
    verbatim — no reconstruction needed. The heading (`2026-03-08T02:39:04.901Z`) is simply dropped:
    the grammar has no heading construct.
  - All six globs carried verbatim (regex, unchecked by the language floor), including `**/*.sh` and
    `**/*.bash`, which no registered language covers — legal precisely because a regex target has no
    grammar binding.
- **`examples`:** `bad` = `git log $UNTRUSTED_REF`; `good` = `git log "$UNTRUSTED_REF" -- .`, chosen
  so the `good` leg is silenced by the `requires` block rather than by a target miss — it certifies
  the absence→`requires` translation directly.
- **Harness:** parses OK, lowers OK (`engine=regex`, 6 globs, `requires(scope=line)`).
- **Differential:** bad FIRES, good silent (silenced by `requires`, verified).
- **Candidate flags:** none as a miss. The one transformation is disclosed above with its exact
  semantic delta; the scorer may wish to price the requirement-window widening.

### 14. `be74c55caa9fd60c` — GitHub Actions input expansion

- **Target:** `.totem/rules/r14-be74c55c-actions-input-expansion.rule.yaml`
- **Transformations:** none beyond carriage. Pattern, `severity`, `message`, and both globs
  (`**/*.yml`, `**/*.yaml`) verbatim. The second timestamp-heading rule: `message` is real content,
  carried verbatim, no reconstruction; heading (`2026-03-07T21:45:57.754Z`) dropped as above.
- **`examples`:** `bad` = a `run:` step interpolating the input expression directly; `good` = the
  canonical GitHub-recommended remedy the `message` prescribes — map the input to an intermediate
  `env:` var and reference `"$REQUESTED_REF"` in `run:`.
- **Harness:** parses OK, lowers OK (`engine=regex`, 2 globs).
- **Differential:** bad FIRES, **good ALSO FIRES** — measured.
- **Candidate flags:**
  - `defective-source` — the rule's stated ban is scoped to `run:` steps, but the pattern is a bare
    textual match on the input expression with no context discrimination, so it fires identically on
    the `env:` mapping that IS the remedy. The `good` leg is the correct fix and still matches; the
    differential is UNSATISFIABLE for this rule as compiled.
  - Not translated to `requires:`: the legacy pattern contains no absence idiom, and inventing one
    (e.g. "require `env:` on the line") would be a new rule, not a translation.

### 15. `b237bcf3b52381b1` — 'pwd' in credential-scanning regexes

- **Target:** `.totem/rules/r14-b237bcf3-pwd-in-credential-regex.rule.yaml`
- **Transformations:** flat pattern `new RegExp($$$ARGS)` verbatim; single glob
  `packages/cli/src/assets/**/*.ts` → `language: typescript`; no narrowing, no negations.
- **`examples`:** `bad` = a credential regex whose alternation includes `pwd`; `good` = the same
  construction with `pwd` removed — the exact remedy the `message` prescribes.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** bad FIRES, **good ALSO FIRES** — measured.
- **Candidate flags:**
  - `construct-gap` — same shape as entry 11. The rule's semantics are a constraint on a
    metavariable's TEXT (`$$$ARGS` must not contain `pwd`); the compiled flat pattern encodes none of
    it and fires on every `new RegExp(...)` in the assets tree. The expressing construct is ast-grep
    `constraints:` with a regex on the metavariable, named INEXPRESSIBLE at V1 by
    `record-lower.ts: V1_INEXPRESSIBLE_NAPI_KEYS`. § Design 8's `requires:` cannot substitute
    (`scope: line` is rejected on ast-grep; `scope: file` inverts the polarity — this rule needs
    must-NOT-contain, and `requires` is must-contain).
  - Honesty note: as in entry 11, the `good` leg is the genuine corrected form. No `new RegExp` call
    can be silent under this matcher.

### 16. `49dd9e4fd02d692b` — character-count instructions in prompts

- **Target:** `.totem/rules/r14-49dd9e4f-llm-character-counting.rule.yaml`
- **Transformations:** none beyond carriage. Pattern verbatim; all seven globs carried verbatim
  (`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.py`, `**/*.md`, `**/*.txt`) — legal on a regex
  target, which has no language binding, and the reason this seven-language scope needs no narrowing
  while the ast-grep rules above do.
- **`examples`:** `bad` = a prompt string with "200 characters"; `good` = the same instruction
  without a count.
- **Harness:** parses OK, lowers OK (`engine=regex`, 7 globs).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `defective-source` — `message` is a truncated sentence fragment identical to the lesson heading
    ("LLMs are notoriously poor at character counting; use") and ends mid-clause, naming no remedy.
    The seed marks the rule `unverified: true`.

### 17. `d940b2c9ffe92e99` — `stdio` in execution options

- **Target:** `.totem/rules/r14-d940b2c9-stdio-in-exec-options.rule.yaml`
- **Transformations:** flat pattern verbatim. **Language narrowing:** declared
  `language: typescript`; dropped `**/*.js` (javascript), `**/*.tsx` and `**/*.jsx` (tsx). Kept
  `**/*.ts`.
- **`examples`:** `bad` = an `execSync` options object carrying `stdio: 'pipe'`; `good` = the same
  call with `stdio` removed.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** **bad does NOT fire** — and neither does anything else. Measured.
- **Candidate flags:**
  - `defective-source`, with a reproducible probe. The compiled pattern
    `{ $$$BEFORE, stdio: $VAL, $$$AFTER }` matched ZERO of seven hand-built candidate snippets
    through `matchAstGrepPattern` at `.ts` (options object inside a call; standalone
    `const opts = {…}`; parenthesized object; `stdio` first; `stdio` last; extra trailing key;
    minimal `{a: 1, stdio: 'pipe', b: 2}`). Control probes isolate the cause: the SAME snippet
    matches `const $X = { $$$BEFORE, stdio: $VAL, $$$AFTER }` (1 hit) and matches the literal
    `{ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }` (1 hit), so both the machinery and the
    metavariables work — it is the BARE-BRACE pattern with a LEADING `$$$` metavariable that parses
    as a statement block rather than an object literal and can therefore never match an object node.
    The legacy rule is a dead matcher: it compiled (`validateAstGrepPattern` only proves
    parseability) and has fired on nothing. The same shape independently affects entry 12's payload.
  - `scope-narrowing` — three of four legacy globs dropped (`**/*.js`, `**/*.tsx`, `**/*.jsx`).
  - Honesty note: the `examples` pair expresses the rule's INTENT and is the pair a working matcher
    would need. It is retained deliberately: rewriting the pattern to make it fire would have been
    authoring a new rule, not translating this one.

### 18. `71935fe9a742137b` — `String()` casting on input patterns

- **Target:** `.totem/rules/r14-71935fe9-string-cast-on-input.rule.yaml`
- **Transformations:** flat pattern verbatim. **Language narrowing:** declared
  `language: typescript`; dropped `**/*.tsx` and `**/*.jsx` (tsx), `**/*.js` (javascript). Kept
  `**/*.ts`.
- **`examples`:** `bad` = `String(input.pattern)`; `good` = the explicit `typeof` guard plus a
  descriptive throw, which is the remedy the `message` prescribes.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:**
  - `scope-narrowing` — three of four legacy globs dropped (`**/*.tsx`, `**/*.js`, `**/*.jsx`).

### 19. `0167a783f75b5ecd` — dynamic imports in utility/adapter layers

- **Target:** `.totem/rules/r14-0167a783-dynamic-import-utility-layer.rule.yaml`
- **Transformations:** identical in shape to entries 8 and 9 — same flat payload, same globs, three
  negations → `excludeGlobs`, `language: typescript`. `message` verbatim and distinct.
- **`examples`:** authored fresh and distinct from entries 8 and 9.
- **Harness:** parses OK, lowers OK (`engine=ast-grep`, `language=typescript`, 1 glob / 3 excludes).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** `defective-source` — same archived over-broad-glob ground as entries 8 and 9
  (same `archivedReason` text in the seed).

### 20. `89184bb5fd960848` — BSD sed and `\x1b` hex escapes

- **Target:** `.totem/rules/r14-89184bb5-bsd-sed-hex-escape.rule.yaml`
- **Transformations:** none beyond carriage. Pattern `sed\s+.*\\x1b` verbatim (single-quoted YAML,
  so the doubled backslash survives as a literal backslash in the matcher); all four globs
  (`**/*.sh`, `**/*.bash`, `**/*.zsh`, `**/*.ksh`) carried verbatim — none resolves to a registered
  language, which is legal because the target is `type: regex`.
- **`examples`:** literal block scalars, so no YAML escape processing touches the escape sequences.
  `bad` = a `sed` ANSI-stripping one-liner; `good` = the `perl -pe` form the `message` prescribes.
- **Harness:** parses OK, lowers OK (`engine=regex`, 4 globs).
- **Differential:** bad FIRES, good silent.
- **Candidate flags:** none.

---

## Summary of candidate flags (for the scorer to type)

| #   | lessonHash         | Candidate flags                                                                                       |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | `d5faa14cbb8b50fb` | —                                                                                                     |
| 2   | `aa7a588d48e74503` | `scope-narrowing`                                                                                     |
| 3   | `87aff037d7de47a7` | —                                                                                                     |
| 4   | `0e01112d5f18ffde` | `defective-source` (inert lookahead; fragment `message`)                                              |
| 5   | `54140f59be3e6e44` | `defective-source` (fragment `message` at severity error)                                             |
| 6   | `6b1890e2dbda3331` | `scope-narrowing`                                                                                     |
| 7   | `5b85fe53468964e1` | `defective-source` (hallucinated API, archived)                                                       |
| 8   | `6467c35159c1504d` | `defective-source` (over-broad globs, archived)                                                       |
| 9   | `65ede9bfdf6995fe` | `defective-source` (over-broad globs, archived)                                                       |
| 10  | `b973609688ec2888` | —                                                                                                     |
| 11  | `6b2b62eb1e8693fc` | `construct-gap` (`constraints:` inexpressible), `scope-narrowing`                                     |
| 12  | `1a7080ebf6162de3` | `out-of-scope` (no `.json` grammar), `defective-source` (archived for it), `payload-gap` (dead shape) |
| 13  | `5da43ea60b66e96e` | — (absence→`requires` translated; requirement-window delta disclosed)                                 |
| 14  | `be74c55caa9fd60c` | `defective-source` (no `run:`/`env:` discrimination)                                                  |
| 15  | `b237bcf3b52381b1` | `construct-gap` (`constraints:` inexpressible)                                                        |
| 16  | `49dd9e4fd02d692b` | `defective-source` (fragment `message`)                                                               |
| 17  | `d940b2c9ffe92e99` | `defective-source` (dead matcher, probe-verified), `scope-narrowing`                                  |
| 18  | `71935fe9a742137b` | `scope-narrowing`                                                                                     |
| 19  | `0167a783f75b5ecd` | `defective-source` (over-broad globs, archived)                                                       |
| 20  | `89184bb5fd960848` | —                                                                                                     |

**Zero `dialect-violation` candidates in this seed:** no seed rule carries a brace glob, a shallow
glob the sanitizer would have promoted, an absolute path, a drive letter, a backslash separator, or
a `.`/`..` segment. Every `!`-negation was translated into `excludeGlobs`, which is the grammar's own
construct and the intended translation, never a violation.

**Differential status across the 20** (measured, `bad` fires ∧ `good` silent per § Design 15 step 4):

| Outcome                                    | Count | Rules                              |
| ------------------------------------------ | ----- | ---------------------------------- |
| Differential satisfied                     | 15    | entries 1–10, 13, 16, 18, 19, 20   |
| `good` also fires (constraint not encoded) | 3     | `6b2b62eb`, `be74c55c`, `b237bcf3` |
| `bad` does not fire (dead matcher)         | 1     | `d940b2c9`                         |
| Not evaluable (lowering rejected)          | 1     | `1a7080eb`                         |

In all five non-satisfying cases the failure is a property of the LEGACY rule carried faithfully
forward, not of the translation: the notes above name the mechanism for each, and every one of them
would have been hidden by authoring an unrelated silent `good`.

---

## Replay

Both harnesses re-run from the committed tree. Output below is verbatim; both are deterministic, so
a re-run at this SHA reproduces it byte for byte.

`node operations-local/r14-validate.mjs` (exit 0):

```
Summary: 20 record(s) — parsed 20, compiled 19, lowering-rejected 1, harness failures 0
```

`node operations-local/r14-differential.mjs` (exit 0):

```
Differential split (measured):
  differential-satisfied   15  (entries 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 18, 19, 20)
  good-also-fires          3  (entries 11, 14, 15)
  bad-does-not-fire        1  (entries 17)
  not-evaluable            1  (entries 12)


Dead-matcher probe — seed entry 17 (d940b2c9ffe92e99)
Pattern under test: { $$$BEFORE, stdio: $VAL, $$$AFTER }

  hits=0  "const out = execSync(cmd, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });"
  hits=0  "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };"
  hits=0  "({ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })"
  hits=0  "const opts = { stdio: 'pipe', encoding: 'utf8' };"
  hits=0  "const opts = { cwd: repoRoot, stdio: 'pipe' };"
  hits=0  "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', shell: true };"
  hits=0  "const opts = { a: 1, stdio: 'pipe', b: 2 };"

  candidates: 7, total hits: 0 (a dead matcher scores 0)

  Controls, over one fixed subject:
  subject: "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };"
    hits=1 (expected 1)  pattern: "const $X = { $$$BEFORE, stdio: $VAL, $$$AFTER }"
    hits=1 (expected 1)  pattern: "{ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }"


Replay check against the recorded verdict:
  REPRODUCED — differential split and dead-matcher probe match the notes.
```

Both controls holding while all seven candidates score zero is what localizes entry 17's failure to
the bare-brace-with-leading-`$$$` shape specifically, rather than to the matcher machinery, the
metavariables, or the probe snippets.

---

## Supplementary twins — post-registration cure (operator ruled (b), 2026-08-22)

**Ruling of record:** mmnto-ai/totem-strategy#288, operator rulings entry 2026-08-22T0354Z, with the
protocol erratum registered first (0351Z): cardinality is spec-faithful **N records per seed rule**
(Prop 310 § Design 6), superseding the translation charter's "one record per seed rule" clause. The
registered 13/20 verdict (PR mmnto-ai/totem-strategy#1092, `5eed24ba`) **binds**; the scorer
re-scores ONLY the two entries below under the identical apparatus and reports the as-cured count
beside it, disclosed as a post-registration cure. None of the 20 registered records changed — the
diff against the pin `62fa5b42` under `.totem/rules/` is additions only.

**The two twins** — each restores the `**/*.js` scope the single-record translation dropped (7
tracked files at the pin, the scorer's item 5):

| Entry | Twin                                                  | Delta from the original                                                    |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| 6     | `r14-6b1890e2-empty-string-in-whitelist-js.rule.yaml` | `language: javascript`; `fileGlobs: ['**/*.js']`; everything else verbatim |
| 18    | `r14-71935fe9-string-cast-on-input-js.rule.yaml`      | same shape                                                                 |

Same fidelity discipline as the originals: pattern, severity, message, `examples`, and
`curation.sourceLesson` carried verbatim; the only authored change is the language/glob pair.
Together with its typescript original, each twin is the entry's N-record translation of the legacy
`**/*.ts` + `**/*.js` scope. The `**/*.tsx` / `**/*.jsx` legs stay dropped: zero tracked files at
the pin, already scored zero-delta.

**Apparatus change (the preceding commit; no record changes):** `r14-differential.mjs` now (1)
dispatches each ast-grep record under its OWN grammar (`language` → `.ts` / `.js` / `.tsx`,
mirroring the runtime's extension dispatch — the twins are measured under javascript, never coerced
through `.ts`); (2) groups N records per seed entry by the `r14-<hash8>-` filename prefix and takes
the WORST verdict over the group, so the 20-entry split stays comparable to the registered verdict
and a twin can never mask a failing original; (3) accepts the frozen draw envelope on `--seed` when
joined via `--corpus <frozen compiled-rules.json>` (the scorer's contract nit). The respondent's
round probe is committed beside it as `r14-treeform-probe.mjs`.

### Replay (this SHA)

`node operations-local/r14-validate.mjs` (exit 0):

```
Summary: 22 record(s) — parsed 22, compiled 21, lowering-rejected 1, harness failures 0
```

`node operations-local/r14-differential.mjs` (exit 0) — the two cured entries, then the split:

```
 6. 6b1890e2dbda3331  differential-satisfied  (2 records)
    empty-string-in-whitelist-js [ast-grep@.js] differential-satisfied: pair0: bad=FIRES good=silent
    empty-string-in-whitelist [ast-grep@.ts] differential-satisfied: pair0: bad=FIRES good=silent
18. 71935fe9a742137b  differential-satisfied  (2 records)
    string-cast-on-input-js [ast-grep@.js] differential-satisfied: pair0: bad=FIRES good=silent
    string-cast-on-input [ast-grep@.ts] differential-satisfied: pair0: bad=FIRES good=silent

Differential split (measured):
  differential-satisfied   15  (entries 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 16, 18, 19, 20)
  good-also-fires          3  (entries 11, 14, 15)
  bad-does-not-fire        1  (entries 17)
  not-evaluable            1  (entries 12)
  REPRODUCED — differential split and dead-matcher probe match the notes.
```

`node operations-local/r14-differential.mjs --seed <seed-20.json> --corpus <frozen compiled-rules.json>`
(exit 0): both twins `identical to seed` on severity · message · pattern; `Unexpected divergences: 0
(expected 0)`.

**What this does and does not claim.** The twins restore the dropped `**/*.js` file scope and satisfy
their differential under the javascript grammar — the mechanically checkable conjuncts. Whether the
two entries now PASS the full § 15 step-4 composite (effective-scope identity over the pinned tree
included) is the scorer's measurement, not the translator's; the count this lands at is the scorer's
to report beside the registered 13/20.

— totem-claude (translator), 2026-08-22

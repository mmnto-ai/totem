# @mmnto/mcp

## 1.25.0

### Patch Changes

- @mmnto/totem@1.25.0

## 1.24.0

### Minor Changes

- 67c3ad3: **ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion (#1684)**

  Closes the cloud-compile bootstrap gap that ADR-091 § Bootstrap Semantics defined: pack rules cannot be trusted to fire on the consumer's codebase until Stage 4 verifies them locally, so they now enter the consumer's manifest as `'pending-verification'` and the next `totem lint` runs the verifier and promotes them per outcome.

  **`CompiledRule.status` enum extended** with a fourth lifecycle value `'pending-verification'` alongside `'active' | 'archived' | 'untested-against-codebase'`. The lint-execution path (`loadCompiledRules`) treats it as inert exactly like `'archived'` and `'untested-against-codebase'`; the admin path (`loadCompiledRulesFile`) returns it unfiltered so the promotion interceptor can find pending entries.

  **`totem install pack/<name>`** now stamps every pack rule `'pending-verification'` regardless of the status the pack shipped with. The pack's authoring environment cannot have run Stage 4 against the consumer's codebase, so the cloud-compile status is meaningless on the consumer side. The install command appends `Run \`totem lint\` to activate pack rules` to its output as the activation hint.

  **`.totem/verification-outcomes.json`** is the new committable side-table that memoizes Stage 4 outcomes across runs. The first lint run after install reads pending rules from the manifest, invokes the Stage 4 verifier on each, maps the outcome to one of the four terminal lifecycle values per Invariant #3, atomically writes the outcomes file with canonical-key-order serialization (Invariant #11 — byte-stable across runs so consumer repos see no phantom diffs), and saves the mutated manifest. Subsequent lint runs read the recorded outcome from the file and skip re-verification (Invariant #4); a pack content update produces a new `lessonHash` which has no recorded outcome, so the verifier runs again (Invariant #5).

  **Per-rule verifier-throw isolation** (Invariant #7): one failing rule's verifier-throw does not abort the lint pass; that rule remains `'pending-verification'` and the next lint retries.

  **Empty-pending fast path** (Invariant #9): the common-case lint pass with zero pending rules pays no verification cost and skips the outcomes-file read entirely.

  **New public API** in `@mmnto/totem`:
  - `promotePendingRules(rules, deps)` and `applyOutcomeToRule(rule, entry)` — the core interceptor.
  - `readVerificationOutcomes(filePath, onWarn?)` and `writeVerificationOutcomes(filePath, outcomes)` — the persistence layer.
  - `VerificationOutcomeEntrySchema`, `VerificationOutcomesFileSchema`, `Stage4OutcomeStored` — Zod schemas.
  - `VerificationOutcomesStore`, `VerificationOutcomesFile`, `VerificationOutcomeEntry`, `Stage4OutcomeStoredValue`, `PromotePendingRulesDeps`, `PromotePendingRulesResult` — types.

  **Naming-collision context (option B):** the original ADR-091 draft specified `.totem/rule-metrics.json` for the verification-outcomes file, but `packages/core/src/rule-metrics.ts` already exists as a per-machine telemetry-cache module (`triggerCount`, `suppressCount`, `evaluationCount`) with a gitignored `.totem/cache/rule-metrics.json` lifetime. ADR-091 § 65 was amended to specify `.totem/verification-outcomes.json` instead — separate filename for the new committable verification state, separate module name (`verification-outcomes.ts`) for the new schemas + persistence layer.

### Patch Changes

- Updated dependencies [67c3ad3]
  - @mmnto/totem@1.24.0

## 1.23.0

### Minor Changes

- 94ea4a8: **Pack v0.1 alpha pilot: `@totem/pack-rust-architecture` lift + ADR-091/097 substrate completion (#1773)**

  First non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate (#1768/#1769/#1770 in 1.22.0). Validates the substrate end-to-end by registering Rust as a language extension and dispatching ast-grep rules against `.rs` source.

  **`@totem/pack-rust-architecture@1.23.0`** — new package (`private: true`)
  - 8 baseline lessons sourced from `mmnto-ai/liquid-city#134` (slice-6 vehicle-agent + dispersion review cycle, lc-Claude attribution preserved)
  - Synchronous CJS `register.cjs` wires Rust into both engine paths: `api.registerLanguage('.rs', 'rust', wasmLoader)` for the web-tree-sitter side and `napi.registerDynamicLanguage({ rust })` for the @ast-grep/napi side (v0.1 side-channel, see `@mmnto/totem#1774`)
  - Bundled `tree-sitter-rust.wasm` (1.1 MB) sourced from `@vscode/tree-sitter-wasm@0.3.1` (MIT, Microsoft) via `prepare`-time copy
  - `compiled-rules.json` ships one tracer-bullet seed rule (`lesson-8cefba95`, Bevy hot-path `Local<Vec<T>>` per-tick allocation) — full LLM-compile of the 8-lesson set deferred to a focused follow-up since γ (per-language `KIND_ALLOW_LIST`, #1655) is needed before LLM-compile of Rust patterns avoids TS-grammar hallucinations
  - Runtime integration tests boot the pack via `loadInstalledPacks({ inMemoryPacks })` and verify the seed rule fires on `.rs` source through the full substrate path

  **`@mmnto/totem` — #1654 fix: thread target Lang through the compile-time pattern validator**

  Pre-#1654, `validateAstGrepPattern` always parsed under `Lang.Tsx` regardless of the rule's `fileGlobs`, and `inferBadExampleExts` (smoke gate) used a TS/JS-only regex that silently fell back to the default set for non-TS rules. A Rust pattern would either false-pass under TSX (the `ResMut<TacticalState>` exhibit) or false-fail with a TSX-parser error.
  - `validateAstGrepPattern(pattern, fileGlobs?)` now resolves the target Lang via `resolveAstGrepLangs(fileGlobs)` and accepts the pattern when any one Lang accepts it. Falls back to `Lang.Tsx` when fileGlobs is empty or no glob carries a registered extension (preserves legacy unscoped-rule semantics).
  - `inferBadExampleExts` extracts any trailing extension from `fileGlobs` (not just TS/JS); runtime's `extensionToLang` filters out unmapped extensions inside `matchAstGrepPattern` so unmapped extensions cleanly return zero matches without parsing under the wrong grammar.
  - New `resolveAstGrepLangs` helper exported alongside `extensionToLang` from `ast-grep-query.ts`.
  - 6 new regression tests covering the LC false-positive exhibit and the TS-fallback preservation invariant.

  **Substrate-extension follow-up filed as #1774 (tier-2, investigation)**: lift the napi-side language registration into `PackRegistrationAPI.registerNapiLanguage` once N≥2 pack consumers exist. PR-B's side-channel pattern in `register.cjs` is the time-boxed precedent that gathers design data; the side-channel is documented as visible debt in the pack's README.

### Patch Changes

- Updated dependencies [94ea4a8]
  - @mmnto/totem@1.23.0

## 1.22.0

### Patch Changes

- Updated dependencies [5f2b0f2]
  - @mmnto/totem@1.22.0

## 1.21.0

### Patch Changes

- Updated dependencies [2ccef47]
  - @mmnto/totem@1.21.0

## 1.20.0

### Patch Changes

- @mmnto/totem@1.20.0

## 1.19.0

### Patch Changes

- Updated dependencies [9686817]
  - @mmnto/totem@1.19.0

## 1.18.3

### Patch Changes

- Updated dependencies [3e03fbf]
  - @mmnto/totem@1.18.3

## 1.18.2

### Patch Changes

- 8addc49: Promote `sanitizeForTerminal` helper from `@mmnto/cli` to `@mmnto/totem` core (`mmnto-ai/totem#1744`). MCP and other downstream consumers can now import the canonical helper directly from `@mmnto/totem` instead of duplicating the regex inline.

  Internal-only refactor: pure file relocation + import-path updates across 5 consumers (4 cli + 1 mcp). The MCP `context.ts` `strategyStatus.reason` rendering now calls `sanitizeForTerminal()` then applies the existing `\n`/`\t` flatten/collapse/trim chain inline (the helper deliberately preserves `\n`/`\t` for callers wanting multi-line content). Tests for the helper move with the source into `packages/core/`.

  The `cli/src/utils.ts` re-export of `sanitizeForTerminal` is dropped; consumers now import directly from `@mmnto/totem`. The orchestrator-graph guard in `shield-estimate.test.ts` continues to hold — `@mmnto/totem` core does not transit the orchestrator graph the way `cli/src/utils.ts` does via its static `./orchestrators/orchestrator.js` import.

- Updated dependencies [8addc49]
  - @mmnto/totem@1.18.2

## 1.18.1

### Patch Changes

- @mmnto/totem@1.18.1

## 1.18.0

### Minor Changes

- bea4cce: feat(consumers): port to `resolveStrategyRoot` (mmnto-ai/totem#1710)

  Builds on the `@mmnto/totem` resolver substrate. Each programmatic consumer
  of the strategy repo now reads through `resolveStrategyRoot` and degrades
  gracefully when the strategy root is unresolvable.

  **`@mmnto/mcp`:**
  - **Schema shape change (treated as minor — see rationale below):**
    `describe_project` rich-state `strategyPointer` payload flips from
    `{ sha, latestJournal }` to a discriminated union:
    `{ resolved: true, sha, latestJournal } | { resolved: false, reason }`.
    Agents that read the rich-state pointer must check `resolved` before
    reading `sha` / `latestJournal`. Only affects callers that opted in via
    `includeRichState: true` — the legacy slim payload is byte-identical.

    **Rationale for minor (not major):** (a) success-path is additive —
    the resolved branch preserves both `sha` and `latestJournal` fields;
    the failure-path now structures what was previously a pair of `null`s
    into a `{ resolved: false, reason }` envelope. (b) No known
    programmatic JSON consumers — the field is consumed across the totem
    ecosystem (mmnto-ai/totem, mmnto-ai/totem-strategy,
    mmnto-ai/totem-playground) exclusively as agent-rendered text via
    SessionStart hooks. (c) No queued cluster of breaking changes to ride
    alongside in a 2.0.0 bundle. The deferred-breaking-changes ledger
    (mmnto-ai/totem#1746) records this decision so the precedent stays
    visible; when that ledger reaches 2-3 substantive items, that bundle
    becomes 2.0.0.

  - **Auto-injected strategy linkedIndex.** `initContext` consults
    `resolveStrategyRoot` and prepends the resolved strategy path to the
    linkedIndexes iteration with a stable link name `'strategy'`. Boundary
    routing (`boundary: 'strategy'`) keeps working regardless of physical
    source (sibling / submodule / env override). Init-time warnings surface
    ONLY when the user explicitly signaled a strategy expectation (env or
    config); zero-config projects without a strategy repo skip silently.

  **`@mmnto/cli`:**
  - `totem proposal new` / `totem adr new` use `resolveStrategyRoot` and
    throw an actionable `TotemError(CONFIG_MISSING)` with a sibling-clone
    hint and `TOTEM_STRATEGY_ROOT` reference when unresolved (per the
    ADR-088 design rationale on actionable error UX). Standalone
    strategy-repo case (cwd IS the strategy repo) is detected before the
    resolver runs.
  - New `totem doctor` "Strategy Root" advisory diagnostic (`pass` /
    `warn`, never `fail`).
  - Bench scripts (`scripts/benchmark-compile.ts`, `scripts/bench-lance-open.ts`)
    hard-fail with actionable messages when the strategy root is unresolvable.

  **`totem.config.ts`:** the literal `linkedIndexes: ['.strategy']` is
  removed; the resolver is now the single source of truth for the strategy
  mesh path.

  **Documentation:** new `CONTRIBUTING.md` "Strategy Repo Expectations"
  section + `docs/architecture.md` update describing the configurable
  resolver.

  `.gitmodules` removal is a separate follow-up after this lands.

### Patch Changes

- Updated dependencies [bea4cce]
  - @mmnto/totem@1.18.0

## 1.17.1

### Patch Changes

- @mmnto/totem@1.17.1

## 1.17.0

### Minor Changes

- 6fd5271: `totem retrospect <pr>` — bot-tax circuit-breaker (mmnto-ai/totem#1713).

  Closes mmnto-ai/totem#1713. Reads a PR's bot-review history live, groups findings into push-based rounds via each review submission's `commit_id` (one round per push, not one round per submission), enriches each finding with cross-PR-recurrence flags read from `.totem/recurrence-stats.json` (mmnto-ai/totem#1715 substrate, read-only) plus rule-coverage flags read from `.totem/compiled-rules.json`, and emits a deterministic verdict per finding: `route-out`, `in-pr-fix`, or `undetermined`. The classifier is a fixed table over the four-axis cube `(severityBucket × roundPosition × crossPrRecurrenceBucket × coveredByRule)`; route-out reasons come from a closed catalog so the report doesn't accumulate one-off prose strings.

  No LLM. No GitHub mutation. Read-only outside the optional `--out <path>` JSON write. Sub-threshold runs exit 0 with a benign skip message; `--force` overrides. The no-LLM invariant is locked down by both a static-source-grep guard (mirrors `totem review --estimate` from mmnto-ai/totem#1714) and a runtime check that every dynamic import in the command file resolves to a non-LLM module.

  New CLI surface: `totem retrospect <pr-number>` with `--threshold <n>` (default 5), `--force`, `--out <path>`. Requires `gh` authenticated against the repo. The `--auto-file` flag proposed in the auto-spec is intentionally deferred to a follow-up ticket (mass-filing is irreversible; v0.1 emits suggested issue titles + bodies the human can copy-paste).

  New core surface: `RetrospectRoundSchema`, `RetrospectClassificationSchema`, `RetrospectFindingSchema`, `RetrospectReportSchema` plus pure helpers `groupFindingsByRound`, `classifyFinding`, `buildStopConditions`, `computeDedupRate`, `signatureOfBody`, `toRoundPosition`, `toCrossPrBucket`. `toSeverityBucket` is now exported from `@mmnto/totem` so the bot-tax cluster (`#1715` + `#1714` + `#1713`) shares one severity vocabulary. `GitHubCliPrAdapter` gains a `fetchReviews(prNumber)` method that reads `gh api repos/.../pulls/N/reviews --paginate` for `commit_id` + `submitted_at` (the existing `fetchPr` JSON shape doesn't include `commit_id`).

### Patch Changes

- Updated dependencies [6fd5271]
  - @mmnto/totem@1.17.0

## 1.16.1

### Patch Changes

- @mmnto/totem@1.16.1

## 1.16.0

### Minor Changes

- 2d5b9ac: `totem stats --pattern-recurrence` — cross-PR recurrence clustering substrate.

  Closes mmnto-ai/totem#1715. Fetches bot-review findings (CodeRabbit + Gemini Code Assist) across the most recent merged PRs (`--history-depth`, default 50, capped at 200), folds in trap-ledger `override` events as co-equal signals, clusters them by a normalized signature (paths + line numbers + code-fence content stripped), filters out clusters covered by an existing compiled rule via Jaccard ≥ 0.6 keyword-overlap on the rule's `message`, and writes the surviving patterns at-or-above `--threshold` (default 5) to `.totem/recurrence-stats.json`. The console summary shows the top 5 by occurrence count.

  This is the substrate of truth for the upcoming `totem retrospect <pr>` (mmnto-ai/totem#1713 bot-tax circuit breaker) and `totem review --estimate` (mmnto-ai/totem#1714 pre-flight estimator) — patterns from those features will read this file rather than re-scan PR history per invocation.

  Output shape is versioned (`version: 1`), stable, and Zod-validated; consumers can parse against `RecurrenceStatsSchema` exported from `@mmnto/totem`. Atomic writes via temp + rename keep concurrent invocations safe.

### Patch Changes

- Updated dependencies [2d5b9ac]
  - @mmnto/totem@1.16.0

## 1.15.10

### Patch Changes

- 4bb87e2: `totem review` operator-dogfood bundle: override stamps the push-gate cache, plus an explicit `--diff <ref-range>` flag.
  - **mmnto-ai/totem#1716** — `totem review --override <reason>` now writes `.totem/cache/.reviewed-content-hash` after recording the override, so the push-gate hook unblocks immediately. Closes the tribal-knowledge `git reset --soft HEAD~1 && totem review --staged` workaround used since the override flag was added. New `recordShieldOverride` helper bundles the trap-ledger write and content-hash stamp into a single call site exercised by both the V2 structured-verdict path and the V1 fallback.
  - **mmnto-ai/totem#1717** — adds `totem review --diff <ref-range>` for explicit diff scope (e.g. `--diff HEAD^..HEAD`, `--diff main...feature`). Bypasses the implicit working-tree → staged → branch-vs-base fallback. The chosen diff source is logged to stderr (`Diff source: explicit-range`, `staged`, `uncommitted`, or `branch-vs-base`) so the operator's mental model matches the actual git invocation. Diffs exceeding 50,000 chars now surface a fail-loud truncation warning at the resolution layer — before the LLM call — so the operator can re-run with a narrower range instead of paying for a degraded review. The flag is documented in `--help`'s "Diff resolution" section. New `getGitDiffRange(cwd, range)` core helper rejects flag-injection ranges (leading `-`) and empty values; arg-array `safeExec` invocation prevents shell-metachar interpretation.

- Updated dependencies [4bb87e2]
  - @mmnto/totem@1.15.10

## 1.15.9

### Patch Changes

- e8792e5: fix(core): enable ast-grep verification in `verifyRuleExamples` (mmnto-ai/totem#1699)

  AI Studio corpus audit ([mmnto-ai/totem-strategy#150](https://github.com/mmnto-ai/totem-strategy/pull/150), B-Q4.1 / Q5 P2-1) finding. `verifyRuleExamples` short-circuited every non-regex rule via `if (rule.engine !== 'regex') return null;`, so ast-grep rules were never verified against their inline `**Example Hit:**` / `**Example Miss:**` blocks during compilation or via `totem rule test`. The downstream tester (`packages/core/src/rule-tester.ts`) already supports ast-grep through its `isAstGrep` branch — the entry point upstream of it was dropping the rule before the existing path could run.

  Real cases were slipping through this gap. Archived rule `e2341ed9229f9a60` shipped with pattern `new $ERROR($$$ARGS)`, matching every error class instantiation; the smoke-gate's bidirectional check (mmnto-ai/totem#1591) would have caught it at compile time if `verifyRuleExamples` had not blocked the engine.
  - **Guard narrowed.** Changed `if (rule.engine !== 'regex') return null;` to `if (rule.engine !== 'regex' && rule.engine !== 'ast-grep') return null;`. Tree-sitter (`engine: 'ast'`) stays skipped because `testRule`'s non-`ast-grep` branch routes through `applyRulesToAdditions`, which is the regex pipeline and does not handle S-expression queries.
  - **Tests.** Added two regression cases pinning the new behavior: ast-grep PASS on a matching badExample / non-matching goodExample, and ast-grep FAIL on the over-broad `new $ERROR($$$ARGS)` shape (the `e2341ed9229f9a60` exhibit class). The pre-existing test that asserted ast-grep returns null is rewritten to cover the Tree-sitter `'ast'` engine, which still legitimately short-circuits.
  - **No CLI surface change required.** `totem rule test <ast-grep-hash>` now returns PASS / FAIL against inline examples instead of warning "Engine 'ast-grep' does not support inline example testing." The compile-pipeline smoke gate (`compile-smoke-gate.ts`) inherits ast-grep coverage through the same entry point.

  Closes mmnto-ai/totem#1699.

- Updated dependencies [e8792e5]
  - @mmnto/totem@1.15.9

## 1.15.8

### Patch Changes

- d1e0bc2: fix(cli): switch triage-pr dedup identity to deterministic rootCommentId (#1666)

  Strategy upstream-feedback item 024 substrate. The previous `deduplicateFindings` used a `(file, line, body keyword Jaccard ≥ 0.3, line proximity ≤ 3)` fuzzy-merge heuristic. On `mmnto-ai/liquid-city#80` R3, GCA emitted six distinct high-severity findings on the same `(file, line)` anchor (all six anchored at the same rule-section start line because GitHub's pull-request inline-comment API requires a `line` field and GCA chose the rule-section header). The fuzzy merge collapsed all six into one entry, hiding five GCA-high findings from the triage summary.
  - **Strict-by-id dedup.** `deduplicateFindings` now uses `rootCommentId` as the primary dedup primitive. Two findings with different `rootCommentId` are ALWAYS distinct, even when bodies are byte-identical and they anchor at the same `(file, line)`.
  - **Body-hash fallback** for synthesized review-body findings (`extractReviewBodyFindings` emits these with `file === '(review body)'` and no `rootCommentId`). Map key is `(file, body)` directly — bounded length, no crypto cost, V8 handles long string keys natively.
  - **Cross-bot independence is now a feature.** When CR and GCA independently flag the same `(file, line)`, both findings surface so consumers can read the agreement as elevated-confidence signal (per the strategy bot-nuance file's "Cross-bot agreement = elevated finding confidence" pattern). The previous fuzzy merge silently masked that signal.
  - **`mergedWith` field stays on the schema, undefined in output.** Backward-compat shim so downstream display consumers don't need a coordinated rewrite.
  - **`extractKeywords` and `jaccardSimilarity` helpers retained as exports** for the deferred `--no-dedup` debug flag (#TBD-follow-up) and ad-hoc analysis scripts. No longer called by core dedup logic.

  Compile-pipeline failure mode shifts from "silent collapse of distinct findings" to "deterministic distinctness when API IDs differ." The 14 prior fuzzy-merge tests are rewritten to match the new semantics; the LC#80 R3 exhibit (6 distinct rootCommentIds on the same file:line) is pinned as a regression test.

  Closes the strategy upstream-feedback batch from `mmnto-ai/totem-strategy#133` — items 020 (#1663), 021 (#1664), 022 (Proposal 248), 023 (#1665), 024 (#1666) all complete.

- Updated dependencies [d1e0bc2]
  - @mmnto/totem@1.15.8

## 1.15.7

### Patch Changes

- 9e3214e: fix(core): emit `self-suppressing-pattern` reasonCode for self-suppressing skips (#1664)

  Strategy upstream-feedback item 021 substrate. Pre-fix, the compile worker silently dropped lessons whose compiled pattern would match `totem-ignore` / `totem-context` (and self-suppress at runtime) — the rejection mapped to `pattern-syntax-invalid` (a retry-pending code), so the lesson never landed in `nonCompilable`. Bot reviewers reading `compiled-rules.json` would synthesize "missing from manifest" findings because the audit trail was empty.
  - New `'self-suppressing-pattern'` member on `NonCompilableReasonCodeSchema`. Sibling to `'context-required'` (#1639) and `'semantic-analysis-required'` (#1640) — both are terminal classifier codes for structural incapacity.
  - Terminal write-policy: NOT in `LEDGER_RETRY_PENDING_CODES`, so `shouldWriteToLedger('self-suppressing-pattern')` returns true. Self-suppression is structural — the same lesson body would produce the same self-suppressing pattern on every retry, so retry-pending would loop forever.
  - `classifyBuildRejectReason` updated: rejection messages containing `'suppression directive'` now map to `'self-suppressing-pattern'` (was: `'pattern-syntax-invalid'`). Other rejection paths (`'Rejected regex'`, `'Invalid ast-grep pattern'`) keep their existing mappings.
  - Bot reviewers can now cite the explicit `reasonCode: 'self-suppressing-pattern'` entry in `nonCompilable` instead of inferring "this lesson is missing" from headcount mismatches.

- Updated dependencies [9e3214e]
  - @mmnto/totem@1.15.7

## 1.15.6

### Patch Changes

- 20c491c: fix(core+cli): honor source-declared `**Scope:**` over LLM emission on Pipeline 2/3 (#1665)

  Strategy item 023 substrate. Inverse of `mmnto-ai/totem#1626` (auto-ADD): the compile worker silently DROPPED test/spec exclusion globs (`!**/*.test.*`, `!**/*.spec.*`) that lessons declared in their `**Scope:**` line. Confirmed twice on `mmnto-ai/liquid-city#80` for rules `5bcc8aad9096c817` and `6c457c82d3945d15`.
  - New `parseDeclaredScope(body)` helper in `@mmnto/totem` that parses the lesson body's `**Scope:**` prose declaration into a glob list. Preserves `!`-prefixed exclusion entries verbatim and preserves authored order. Returns `undefined` for missing/empty/whitespace-only declarations.
  - New `isGlobSetEqual(a, b)` pure helper for set-of-strings comparison. Order-insensitive, duplicate-insensitive, sign-sensitive (`'!**/*.test.*'` does not equal `'**/*.test.*'`).
  - `extractManualPattern` (Pipeline 1) refactored to delegate Scope parsing to `parseDeclaredScope` so the manual flow shares a single source of truth with Pipeline 2/3.
  - `BuildCompiledRuleOptions.lessonBody?: string` opts callers into the override path. When supplied AND the body declares a `**Scope:**` line, the parsed source-Scope glob list takes precedence over `parsed.fileGlobs` regardless of LLM emission. Both lists pass through `sanitizeFileGlobs` for parity (shallow → recursive normalization).
  - `BuildRuleResult.scopeOverride?: { from: string[] | undefined; to: string[] }` reports the override event when the override actually changed the emitted globs. Threaded through rejection paths too. Mirrors `severityOverride` discipline from #1656.
  - New `onScopeOverride` callback on `CompileLessonCallbacks` wired to a `writeScopeOverrideTelemetry` closure in CLI `compile.ts` that records `type: 'scope-override'` entries to `.totem/temp/telemetry.jsonl`. Cloud-compile path also wired.
  - Author intent supreme: source-declared Scope overrides the LLM's emission AND the #1626 test-contract auto-include heuristic. The auto-include path stays active only when the lesson omits Scope.

  Compile pipeline failure mode shifts from "silent drop" to "deterministic override + telemetry on divergence." Strict-fail compile gate is deferred to a follow-up if telemetry reveals persistent LLM drift.

- Updated dependencies [20c491c]
  - @mmnto/totem@1.15.6

## 1.15.5

### Patch Changes

- aebf82f: feat(core+mcp): `applies-to` lesson frontmatter for role-of-code citation accuracy (#1663)

  Strategy item 020 substrate. Lesson frontmatter gains an `applies-to:` field carrying a closed role taxonomy (`mutator`, `boundary`, `aggregator`, `hot-path`, `boundary-test`, `infrastructure`, `presentation`, `any`) so downstream bot reviewers can filter lessons by role match instead of grep-by-topic heuristics.
  - New public exports from `@mmnto/totem`: `LessonRole`, `LessonRoleSchema`, `filterLessonsByRole`, `LessonWithAppliesTo`.
  - YAML and prose wire formats both supported. YAML accepts list (`applies-to: [mutator, boundary]`) and scalar (`applies-to: mutator`) forms; prose form is `**Applies-to:** mutator, boundary`. Mixed-case input is lowercased; empty arrays normalize to `['any']`; missing field defaults to `['any']`.
  - `mcp__totem-dev__add_lesson` gains an optional `applies_to` argument (snake_case at the MCP boundary, kebab-case in the on-disk frontmatter per item 020).
  - Pure `filterLessonsByRole(lessons, targetRole?)` utility exported for downstream consumers; `targetRole` undefined returns input unchanged, otherwise keeps lessons whose `appliesTo` includes the target OR `'any'`.
  - Backwards-compat: existing 1,159 lessons continue to parse with `appliesTo: ['any']` deterministically; no migration required.

  Bot-prompt integration and the function-role classifier are out of scope for this PR (see follow-up tickets at PR merge). Item 020 is the Proposal 248 (`mmnto-ai/totem-strategy#136`) substrate prereq for per-bot operations packs.

- Updated dependencies [aebf82f]
  - @mmnto/totem@1.15.5

## 1.15.4

### Patch Changes

- d295439: 1.15.4 bundles two compile-worker prompt classifier improvements that surfaced from downstream consumer friction on `mmnto-ai/liquid-city`. Both close fidelity gaps between the lesson prose authors wrote and the compiled rule that shipped.

  ## Test-contract scope classifier (closes #1626)
  - New `### Test-Contract Scope Classifier (mmnto-ai/totem#1626)` section on both `COMPILER_SYSTEM_PROMPT` and `PIPELINE3_COMPILER_PROMPT`. Teaches the compile-worker to recognize lessons whose hazard is **behavior inside test files** (assertion conventions, spy / mock contracts, test-fixture hygiene) and emit test-inclusive `fileGlobs` instead of the default `!**/*.test.*` exclusion.
  - Three positive signals classify a lesson as test-contract: the `testing` tag, test-framework calls in `badExample`/`goodExample` (`describe(`, `it(`, `test(`, `expect(`, `vi.mock(`, `jest.mock(`, `beforeEach(`, `afterEach(`, `vi.spyOn(`, `jest.spyOn(`), or lesson-body references to test-execution-specific behavior.
  - Broad test-inclusive glob set for test-contract rules: `["**/*.test.*", "**/*.spec.*", "**/tests/**/*.*", "**/__tests__/**/*.*"]`. Narrow test-scoped globs (e.g., `packages/e2e/**/*.spec.ts`) are preserved when the lesson clearly targets them.
  - False-positive trap guard: the word "contract" alone does NOT classify a lesson as test-scoped. Lessons titled "Define strict API Data Contracts" or "Versioning contracts for REST endpoints" describe application-surface invariants. Classification requires the `testing` tag OR test-framework code in the examples alongside any keyword match.

  **Downstream impact:** Two `liquid-city` rules (`"Normalize temp paths for cross-platform equality"`, `"Spy on logger contracts in tests"`) were shipping with scopes that excluded tests and silently never fired. A follow-up chore cycle (`totem compile --upgrade <hash>` per rule) retriages existing corpus against the new prompt.

  ## Declared severity override (closes #1656)
  - New `parseDeclaredSeverity(body: string)` helper exported from `@mmnto/totem`. Parses `**Severity:** error` / `Severity: warning` prose declarations from a lesson body and returns a normalized `'error' | 'warning' | undefined`. Tolerates common markdown and punctuation shapes: bold markers (`**`, `*`, `_`) on either side, backtick-wrapped values, trailing sentence punctuation (`.`, `,`, `;`, `:`, `!`, `?`), and combined shapes like `**Severity: error**.`. Strict enum equality follows the strip, so out-of-vocabulary tokens (`info`, `critical`) return `undefined`.
  - `buildCompiledRule` honors a new `declaredSeverityOverride` option on `BuildCompiledRuleOptions`. Post-LLM override wins over `parsed.severity` regardless of LLM emission. Marker fires in `BuildRuleResult.severityOverride` only when the override actually changed the outcome (declared value differs from `emittedSeverity ?? 'warning'`). Marker is threaded through rejection paths too, so telemetry captures prompt-drift even when the rule fails for other reasons.
  - New `onSeverityOverride` callback on `CompileLessonCallbacks` fires when the override changes the emitted severity. CLI `compile.ts` wires a `writeSeverityOverrideTelemetry` closure that appends records tagged `type: 'severity-override'` to `.totem/temp/telemetry.jsonl` via the cwd-aware `totemDir` (matches the `mmnto-ai/totem#1645` pattern). Fire-and-forget; sink failures do not interfere with compile results.
  - New `### Declared Severity (mmnto-ai/totem#1656)` directive section on both compile prompts instructs the LLM to honor prose-declared severity in its emitted JSON. Every Output Schema example and every concrete Lesson → Output few-shot example now carries `"severity": "warning"` (the default) to reduce drift at source.

  **Downstream impact:** Five `liquid-city` ADR-008 rules on PR 77 burned ~10 manual severity-edit commits across R2 + R3 rounds because the compile pipeline emitted `"severity": "warning"` despite lesson prose declaring `Severity: error`. The mechanical re-edit loop closes; the next `totem lesson compile` cycle on LC emits declared severity directly.

  ## Strategy submodule bump
  - `.strategy` submodule pointer advances from `113179c` to `7892892b`. Picks up strategy PR #125 (upstream-feedback items 015 + 016 from liquid-city session-17) and strategy PR #124 (upstream-feedback item 017 — three-layer language support gap addendum that documents the architectural surface of the pending Rust-support arc).

- Updated dependencies [d295439]
  - @mmnto/totem@1.15.4

## 1.15.3

### Patch Changes

- b782d4e: 1.15.3 bundles three compile-worker quality fixes and the runtime ReDoS defense. All three extend the ADR-091 Classify stage or harden the deterministic-enforcement path under `totem lint`.

  ## Bounded regex execution (closes #1641)
  - Runtime per-rule-per-file timeout on regex evaluation via a persistent Node worker thread. Catastrophic-backtracking patterns now terminate at the configured budget instead of hanging `totem lint`. Pre-exhibit defense against a ReDoS attack chain that survives every prior gate (`safe-regex` static check, bidirectional smoke gate, human promotion review).
  - `totem lint --timeout-mode <strict|lenient>` — new flag on the lint command. `strict` (default) fails non-zero on any timeout; `lenient` skips the offending rule-file pair with a visible warning. Strict mode is the CI path.
  - New `packages/core/src/regex-safety/` module (`evaluator.ts`, `worker.ts`, `apply-rules-bounded.ts`, `telemetry.ts`). Async `applyRulesToAdditionsBounded` sibling to the sync path, policy-free — returns `{violations, timeoutOutcomes}` and lets the CLI apply strict-vs-lenient exit-code policy.
  - Telemetry: every terminal outcome (match, no-match, timeout, syntax error) writes a `type: 'regex-execution'` record to `.totem/temp/telemetry.jsonl`, Zod-validated against `RegexTelemetrySchema` with repo-relative path redaction (paths outside the repo root become `<extern:<sha256-12>>`).
  - Race-condition hardening baked in: `respawnPromise` coalesces concurrent respawn requests, `MAX_CONSECUTIVE_RESPAWNS` guards against infinite spawn loops on a permanently-broken worker, and a cold-start gate prevents the 100ms default from misfiring under CI load.

  ## Context-required classifier (closes #1598)
  - New `reasonCode: 'context-required'` route on the compile-worker output schema. Lessons whose hazard is scope-bounded by a context the pattern cannot structurally capture (e.g., `"sim.tick() must not advance inside _process"`) now route to the `nonCompilable` ledger instead of compiling into false-positive-prone rules.
  - Narrow LLM-emittable enum on `CompilerOutputBaseSchema.reasonCode` (not the full `NonCompilableReasonCodeSchema`), preventing the LLM from forging internal codes like `verify-retry-exhausted`. Extends ADR-091's Classify stage.
  - New **Context Constraints Classifier** section on the compile prompt with marker heuristics (inside / when / only-for-new / must-not) and an explicit **anti-lazy** rule-of-thumb: compilation MUST still succeed when `fileGlobs` / ast-grep `kind:` / `inside:` / `has:` / `regex:` combinators can express the guard.

  ## Semantic-analysis classifier + ledger hygiene

  Closes #1634 + #1627.
  - Extends the narrow `reasonCode` enum with `'semantic-analysis-required'` covering four sub-classes: multi-file contracts, closure-body AST analysis, system-parameter-aware scoping, project-state-conditional semantics. Sub-class carried in the prose `reason`; one consolidated code keeps the LLM contract tight.
  - Pipeline 2 and Pipeline 3 `!parsed.compilable` branches switch from per-code conditional checks to `parsed.reasonCode ?? 'out-of-scope'`. Future narrow classifiers thread through without per-code switches.
  - `LEDGER_RETRY_PENDING_CODES` set + `shouldWriteToLedger(reasonCode)` predicate exported from `@mmnto/totem`. CLI ledger guard now rejects writes for retry-pending codes (`pattern-syntax-invalid`, `pattern-zero-match`, `verify-retry-exhausted`, `missing-badexample`, `missing-goodexample`, `matches-good-example`) so transient smoke-gate rejections no longer permanently mark lessons as unfit.
  - Symmetric stale-entry prune on both compiled branches (local + cloud) when a lesson compiles cleanly, and on cloud smoke-gate rejection. Cleaned three stale `matches-good-example` entries from the shipped ledger.

- Updated dependencies [b782d4e]
  - @mmnto/totem@1.15.3

## 1.15.2

### Patch Changes

- 1c766c2: 1.15.2 ships the archive-in-place durability substrate from #1587 and the new `totem lesson archive` atomic command.

  ## Governance durability (closes #1587)
  - `totem lesson compile --refresh-manifest` — new no-LLM primitive that recomputes `compile-manifest.json` output_hash from the current `compiled-rules.json` state. Closes the postmerge inline-archive gap where the no-op compile path only detected input-hash drift. Strict exclusivity with `--force`.
  - `totem lesson compile --force` now preserves `status`, `archivedReason`, and `archivedAt` additively on rules whose `lessonHash` survives to the new output. Transient compile failures (network / rate-limit / manual reject / example-verification / cloud parse) leave the old rule intact instead of silently dropping it. Implemented via the new `preserveLifecycleFields` helper in core and `upsertRule` / `removeRuleByHash` helpers in the CLI compile loop (replace-by-hash on success; remove-on-skipped; unchanged on failed / noop). Dangling-archive guard preserved — rules whose source lesson was deleted are never resurrected.
  - `totem lesson archive <hash> [--reason <string>]` — new atomic command mirroring `totem rule promote`. Flips the rule's `status` to `archived`, stamps `archivedAt` on first transition, preserves `archivedAt` on reruns, refreshes the manifest, and regenerates copilot + junie exports — all in one call. Matches prefix on `lessonHash`; duplicate-full-hash collisions surface as data-corruption errors distinct from prefix ambiguity.
  - `/postmerge` skill doc rewritten to call `totem lesson archive` directly, retiring the hand-rolled `scripts/archive-bad-postmerge-*.cjs` pattern.

- Updated dependencies [1c766c2]
  - @mmnto/totem@1.15.2

## 1.15.1

### Patch Changes

- e69edb2: 1.15.1 ships the `totem proposal new` and `totem adr new` scaffolding commands that close out #1288.

  ## Governance authoring (closes #1288)
  - `totem proposal new <title>` scaffolds a new strategy proposal at `.strategy/proposals/active/NNN-kebab-title.md` with the canonical template (Status / Author / Date / Milestone + Motivation / Problem Statement / Proposed Solution / Consequences / Decision Needed).
  - `totem adr new <title>` scaffolds a new ADR at `.strategy/adr/adr-NNN-kebab-title.md` with the Format B convention (`# ADR NNN: Title`, Status / Context / Decision / Consequences).
  - Both commands auto-increment the number by scanning the target directory, collision-check before any disk writes, and warn-and-continue on post-scaffold hooks so partial failures do not leave orphan files.
  - Runs `pnpm run docs:inject` automatically when the project has that script configured, so the `PROPOSAL_INBOX` and `ADR_TABLE` dashboards in README.md refresh without manual intervention.
  - New orchestrator at `packages/cli/src/utils/governance.ts` with 5 helpers and 2 default templates. 34 new tests covering slug validation, collision detection, number inference, template selection, and hook degradation.
  - `@totem/pack-agent-security` allowlist updated for the 2 legitimate `spawn` sites the new commands introduce.

- Updated dependencies [e69edb2]
  - @mmnto/totem@1.15.1

## 1.15.0

### Minor Changes

- f9c287b: 1.15.0 ships Pack Distribution: the first shippable Totem pack, plus the compile-hardening and zero-trust substrate that makes packs safe to distribute.

  ## Pack Distribution
  - `@totem/pack-agent-security` (ADR-089 flagship pack). 5 immutable security rules covering unauthorized process spawning, dynamic code evaluation with non-literal arguments, network exfiltration via hardcoded IPs or suspicious domains (API + shell-string variants), and obfuscated string assembly via byte-level primitives. Every rule ships `immutable: true` + `severity: error` + `category: security` with bad/good fixture pairs and 57 unit tests.
  - `totem install pack/<name>` command installs a published pack into the local manifest.
  - `pack-merge` primitive refuses downgrade of immutable rules to warning or archived; bypass attempts log to the Trap Ledger.
  - Content-hash substrate across TypeScript and bash (review + sync + pre-push hook) so pack integrity verifies without relying on file timestamps.

  ## Zero-trust default (ADR-089)
  - Pipeline 2 and Pipeline 3 LLM-generated rules now ship `unverified: true` unconditionally. Activation via the atomic `totem rule promote <hash>` CLI or the ADR-091 Stage 4 Codebase Verifier in 1.16.0.
  - Pipeline 1 (manual) keeps its conditional semantics; human-authored rules are self-evidencing.

  ## Compile hardening (ADR-088 Phase 1)
  - Layer 3 verify-retry loop: rules that fail their own smoke test re-prompt once before the compiler rejects them.
  - Compile-time smoke gate runs both `badExample` and `goodExample`; rules that fire on both directions are rejected with reason code `matches-good-example` (closes the over-matching hole that drove the 2026-04-18 security-pack 10-of-10 archive rate).
  - `archivedAt` timestamp preserved across schema round-trips so the institutional first-archive-provenance ledger survives every compile cycle.
  - `unverified` flag and `nonCompilable` 4-tuple with 9-value reason-code enum replaces the opaque 2-tuples.
  - `totem doctor` stale-rule advisory (ADR-088 Phase 1) plus the grandfathered-rule advisory that surfaces the pre-zero-trust cohort categorized by `vintage-pre-1.13.0`, `no-badExample`, and `no-goodExample`.

  ## Platform
  - Compound ast-grep rules (ADR-087, promoted from Proposal 226). `astGrepYamlRule` field on `CompiledRule` with mutual exclusion on `astGrepPattern`, structural combinators (all / any / not / inside / has / precedes / follows), and canonical-serialization hashing via `canonicalStringify`.
  - Windows shell-injection fix in `safeExec` via `cross-spawn.sync` (closes a three-week-latent vector).
  - Cross-Repo Context Mesh (`totem search` federation + `totem doctor` Linked Indexes health check).
  - Standalone binary distribution unblocked (darwin-arm64, linux-x64, win32-x64).

  ## Positioning
  - **ADR-090 (Multi-Agent State Substrate).** Scopes Totem as the shared state, enforcement, and audit substrate for multi-agent development. Totem does not own agent routing, capability negotiation, session lifecycle, or live-edit conflict resolution. Future feature admission passes the Scope Decision Test.
  - **ADR-091 (Ingestion Pipeline Refinements).** Redefines the 1.16.0 ingestion pipeline as a 5-stage funnel: Extract → Classify → Compile → Verify-Against-Codebase → Activate. Renames the legacy `allowlist` terminology to `baseline`.
  - **ADR-085 (Pack Ecosystem).** Accepted with five deferred decisions resolved: Behavioral SemVer with refinement classification, array-order precedence plus `totem doctor` shadowing warning, Local Supreme Authority with ADR-089 immutable-severity carve-out, Sigstore + in-toto signing, native npm lifecycle with 72-hour unpublish constraint.

  Detailed patch-level changes: CHANGELOG.md entries 1.14.1 through 1.14.17.

### Patch Changes

- Updated dependencies [f9c287b]
  - @mmnto/totem@1.15.0

## 1.14.17

### Patch Changes

- @mmnto/totem@1.14.17

## 1.14.16

### Patch Changes

- b7f298c: Ship the ADR-089 zero-trust default and the `totem rule promote` CLI (mmnto-ai/totem#1581, part 1 of 2).

  **Zero-trust default (core):** every LLM-generated rule now ships `unverified: true` unconditionally. Pipeline 2 (verify-retry loop) and Pipeline 3 (Bad/Good example-based) both flip from the pre-#1581 conditional behavior (keyed on Example Hit presence) to unconditional. Pipeline 1 (manual) keeps its pre-#1581 conditional semantics because manual rules are human-authored and self-evidencing; the existing Pipeline 1 Example-Hit guard stays as a safety net.

  Rationale: the LLM cannot self-certify structural invariants. Example Hit/Miss is an LLM-produced artifact of the compile process, not a human sign-off. Activation requires either human promotion via the new CLI below OR the ADR-091 Stage 4 Codebase Verifier in 1.16.0 (which validates rules empirically against actual code, not against LLM-generated snippet fixtures).

  **`totem rule promote <id>` CLI:** flips a rule's `unverified: true` flag to absent (canonical "verified" state), atomically refreshes `compile-manifest.json`'s `output_hash` so `verify-manifest` passes on the next push. Refuses to promote archived rules and refuses when the target rule is already verified. Exits 1 on ambiguous prefix matches with a disambiguation list.

  Hand-editing `compiled-rules.json` to flip `unverified` would break the manifest hash and trip the pre-push `verify-manifest` gate. The promote command is the blessed path; the atomic refresh closes that user trap at source.

  **Scope split:** the "Option 1 + Categorized Advisory" plan locks the 1.15.0 ship gate via this PR. The categorized `totem doctor` advisory that surfaces the 357 grandfathered pre-1.13.0 rules by reason lands as a follow-up PR on a separate branch to keep the reviewable surface tight.

  Closes #1581 (part 1).

- 358336e: Add `archivedAt` to `CompiledRuleBaseSchema` so Zod stops silently stripping it on round-trips (mmnto-ai/totem#1589).

  Pre-#1589, the schema declared `status`, `archivedReason`, `badExample`, `goodExample`, and a half-dozen other lifecycle fields — but not `archivedAt`. Zod's default behavior strips unknown keys during parse/serialize. Every compile-write cycle that round-tripped `compiled-rules.json` through `CompiledRulesFileSchema.parse()` silently erased prior `archivedAt` values from archived rules. Postmerge archive scripts (`scripts/archive-postmerge-*.cjs`) set the field via raw JSON mutation; it survived on disk until the next `totem lesson compile --export` quietly rewrote the file. Observed on PR #1588 (rule `4b091a1bc7d286d6`, archived 2026-04-19, timestamp lost during postmerge re-export). GCA caught the drop and we restored the timestamp manually; this ticket prevents future losses at the schema level.

  The field is declared `z.string().optional()` for backward compatibility with pre-#1589 manifests that never had the field populated. Existing call sites continue to work unchanged.

  Four new tests in `compiler-schema.test.ts` pin the invariant: accepts a rule with `archivedAt` set, preserves the field across a full parse → serialize → parse round-trip, tolerates an active rule without the field, and preserves the full archive tuple (`status` + `archivedReason` + `archivedAt`) together.

  Closes #1589.

- Updated dependencies [b7f298c]
- Updated dependencies [358336e]
  - @mmnto/totem@1.14.16

## 1.14.15

### Patch Changes

- 89ca890: Extend the compile-time smoke gate with an over-matching check via `goodExample` (mmnto-ai/totem#1580).

  The gate now verifies both directions: the rule MUST match its `badExample` (under-matching check, in place since #1408) AND MUST NOT match its `goodExample` (over-matching check, new). A rule that fires on both sides is over-broad and produces false positives on every lint run, which was the dominant defect class observed in the 2026-04-18 security-pack postmerge incident (10-of-10 bad rate from #1526).

  `CompilerOutputSchema.goodExample` flips from optional to engine-conditional required for regex and ast-grep engines, mirroring the #1420 flip for `badExample`. The `ast` engine (Tree-sitter S-expression queries) remains exempt because the smoke gate does not yet evaluate those. `CompiledRuleSchema.goodExample` stays optional on the persisted-rule boundary for backward compat with pre-#1580 rules.

  Two new reason codes added to `NonCompilableReasonCodeSchema`: `matches-good-example` (over-match rejection) and `missing-goodexample` (defensive path for callers that bypass the schema refine). Rejected lessons surface in the `nonCompilable` ledger with the correct code so `totem doctor` and downstream telemetry can distinguish over-match rejections from other skip categories.

  Pipeline 3 automatically threads the lesson's Good snippet through as `goodExampleOverride`; Pipeline 2 requires the LLM to emit `goodExample` alongside `badExample` via the updated compiler prompt. Pipeline 1 (manual) is unaffected — the gate is opt-in via `enforceSmokeGate`.

  Closes #1580.

- Updated dependencies [89ca890]
  - @mmnto/totem@1.14.15

## 1.14.14

### Patch Changes

- e073dc0: Flip Pipeline 5 auto-capture on `totem review` from opt-out to opt-in.

  `--no-auto-capture` is renamed to `--auto-capture`; the default is now OFF. Observation rules captured from review findings are context-less (regex drawn from the flagged line, message taken from the reviewer, `fileGlobs` scoped to the whole codebase) and routinely pollute `compiled-rules.json` with rules that fire on unrelated files. The Liquid City Session 6 audit measured an 8-rule wave across 5 review invocations producing 13 new warnings on the next `totem lint`, up from 0.

  To preserve the old behavior, pass `--auto-capture` explicitly. Auto-capture will resume as a default once ADR-091 Stage 2 Classifier + Stage 4 Codebase Verifier ship in 1.16.0 and the LLM-emitted rule loop has gates that prevent context-less emissions.

  Closes #1579.

- Updated dependencies [e073dc0]
  - @mmnto/totem@1.14.14

## 1.14.13

### Patch Changes

- 8dd8dc8: core: thread per-invocation `RuleEngineContext` through the rule engine

  Removes the module-level `let coreLogger` / `let shieldContextDeprecationWarned` state from `rule-engine.ts` and replaces the hidden DI setter (`setCoreLogger` / `resetShieldContextWarning`) with a required `RuleEngineContext` parameter on `applyRulesToAdditions`, `applyAstRulesToAdditions`, `applyRules`, and `extractJustification`. Concurrent or federated rule evaluations cannot bleed logger wiring or deprecation-warning latching across each other. Closes mmnto-ai/totem#1441.

  **Breaking:** `setCoreLogger` and `resetShieldContextWarning` are removed from `@mmnto/totem`. Callers must build a `RuleEngineContext` once per linting invocation and pass it as the first argument to the affected functions. See the README or the `RuleEngineContext` JSDoc for the shape.

- Updated dependencies [8dd8dc8]
  - @mmnto/totem@1.14.13

## 1.14.12

### Patch Changes

- dad363b: ADR-088 Phase 1 Layer 4 substrate: compile --verbose trace + doctor stale-rule advisory.

  `totem compile --verbose` emits a structured per-lesson layer-trace block
  that shows which pipeline the lesson took, the generated pattern hash,
  verify outcome, retry scheduling, and the terminal result plus reasonCode
  on skip. Output ships via a single `process.stdout.write` per lesson so
  concurrent compiles do not interleave within a block. The trace is
  produced unconditionally on `CompileLessonResult.trace` across all three
  pipelines (layer 1 manual, layer 2 example-based, layer 3 Layer 3 LLM
  with verify-retry); callers that do not pass `--verbose` pay only the
  cost of a small per-lesson array.

  `RuleMetric` gains an `evaluationCount` field. `runCompiledRules`
  increments it exactly once per rule per lint run, regardless of how many
  matches fire. Pre-#1483 rule-metrics.json files load with the new field
  defaulted to zero via Zod, so the migration is transparent.

  `totem doctor` adds a stale-rule advisory that flags active rules whose
  cumulative `evaluationCount` has crossed a configurable window while
  `contextCounts.code` stayed at zero. Security rules (category=security
  OR immutable=true) land with a higher-severity label and the advisory
  declines to recommend archival for them; standard rules get both
  `totem compile --upgrade <hash>` and archival as recovery paths.
  `TotemConfig.doctor.staleRuleWindow` (default 10) gates the check. v1
  uses cumulative-lifetime semantics; #1550 tracks the rolling-window
  upgrade via `RuleMetric.runHistory` ring buffer, behind the same config
  key so no user migration is needed.

  Advisory only: no auto-archive, no mutation to the rules file. The
  existing `totem doctor --pr` autonomous minAgeDays GC path is untouched.

  Closes #1482. Closes #1483.

- 1107f24: ADR-088 Phase 1 Layers 3 and 4 substrate: unverified flag and reason codes.

  `CompiledRule` gains an optional `unverified: boolean` field, set to `true`
  when the rule was compiled from a lesson lacking a non-empty Example Hit
  block. Pipeline 1 (manual), Pipeline 2 (LLM), and Pipeline 3 (example-based)
  all flag the rule rather than shipping a pattern with no ground truth.
  Security-scoped lessons (`deps.securityContext === true` or a manual rule
  with `immutable: true`) reject outright instead of flagging, per the
  Decision 3 zero-tolerance policy. Absence of the field preserves pre-#1480
  manifest hashes via `canonicalStringify`; the literal `false` is never
  written.

  The `nonCompilable` ledger upgrades from `{hash, title}` to the 4-tuple
  `{hash, title, reasonCode, reason?}`. `reasonCode` is one of
  `no-pattern-generated`, `pattern-syntax-invalid`, `pattern-zero-match`,
  `verify-retry-exhausted`, `security-rule-rejected`, `no-pattern-found`,
  `out-of-scope`, `missing-badexample`, or `legacy-unknown`. The loader
  accepts all three historical shapes (string, 2-tuple, 4-tuple) and
  normalizes legacy rows to `reasonCode: 'legacy-unknown'`; the writer
  enforces the 4-tuple via a strict `NonCompilableEntryWriteSchema`.
  `saveCompiledRulesFile` validates every entry before serialization and
  throws on schema mismatch, following the lesson 400fed87 Read/Write
  invariant.

  Pipeline 2 validator rejections (invalid regex, unparseable ast-grep) and
  LLM-response parse failures move from the `failed` bucket to `skipped`
  with an explicit reasonCode so ADR-088 Layer 4 telemetry sees every
  outcome. `compile.ts` `nonCompilableMap` now carries the full 4-tuple
  through the run, and `install.ts` pack-merge routes writes through
  `saveCompiledRulesFile` so pack installs also go through the Write
  schema gate.

  Closes #1480. Closes #1481.

- Updated dependencies [dad363b]
- Updated dependencies [1107f24]
  - @mmnto/totem@1.14.12

## 1.14.11

### Patch Changes

- fc0d367: Config-driven source-extension list for the review content hash.

  Polyglot repos can now override the historical `['.ts', '.tsx', '.js', '.jsx']` set by declaring `review.sourceExtensions` in `totem.config.ts`. The CLI writes the validated set to `.totem/review-extensions.txt` on every `totem sync`, and `.claude/hooks/content-hash.sh` reads it so both implementations stay in lockstep. Defaults are unchanged; consumers who do not set the field see no behavior difference. Closes #1527 and #1529.

- Updated dependencies [fc0d367]
  - @mmnto/totem@1.14.11

## 1.14.10

### Patch Changes

- Updated dependencies [84bba42]
- Updated dependencies [6776b11]
  - @mmnto/totem@1.14.10

## 1.14.9

### Patch Changes

- Updated dependencies [e96599e]
  - @mmnto/totem@1.14.9

## 1.14.8

### Patch Changes

- Updated dependencies [bcc9c72]
  - @mmnto/totem@1.14.8

## 1.14.7

### Patch Changes

- Updated dependencies [cb51b59]
  - @mmnto/totem@1.14.7

## 1.14.6

### Patch Changes

- Updated dependencies [6b58563]
  - @mmnto/totem@1.14.6

## 1.14.5

### Patch Changes

- Updated dependencies [bd63810]
  - @mmnto/totem@1.14.5

## 1.14.4

### Patch Changes

- Updated dependencies [55a7e19]
  - @mmnto/totem@1.14.4

## 1.14.3

### Patch Changes

- Updated dependencies [0b3e274]
  - @mmnto/totem@1.14.3

## 1.14.2

### Patch Changes

- @mmnto/totem@1.14.2

## 1.14.1

### Patch Changes

- b0a46b7: Fix `add_lesson` MCP tool double-prepending `## Lesson —` heading (#1284)

  When a caller passed a pre-formatted lesson to the `add_lesson` MCP tool whose body already started with a canonical `## Lesson — Foo` heading, the tool derived a title from the first line of the body — which included the literal `Lesson —` prefix — and produced a file with `## Lesson — Lesson — Foo` as the wrapper, with the original `## Lesson — Foo` still intact inside the body. The parser correctly read that as two separate lessons.

  The tool now detects a pre-existing canonical heading (em-dash, en-dash, or hyphen variants, consistent with the parser fix in #1278), extracts the title, and strips the heading line from the body before wrapping. Callers who pass plain body text with no leading heading see unchanged behavior.

  Closes #1284. Discovered during PR #1282 dogfooding.

- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
  - @mmnto/totem@1.14.1

## 1.14.0

### Minor Changes

- 11ab03b: 1.14.0 — The Nervous System Foundation

  Cross-repo federated context (shipped as the headline feature) plus opt-in preview of persistent LLM context caching. Mesh and caching are two halves of the same nervous system — sharing context across space (cross-repo federation) and across time (cached tokens) — but they ship at different maturity levels in 1.14.0: mesh is the active default, caching is opt-in preview machinery whose default activation is tracked for 1.15.0 in mmnto/totem#1291.
  - **Cross-Repo Context Mesh (#1295):** New `linkedIndexes: []` option in `totem.config.ts` lets a repo federate semantic search against sibling Totem-managed repos. `SearchResult` now carries a required `SourceContext` with `sourceRepo` and `absoluteFilePath` so agents can Read/Edit results unambiguously regardless of which repo the hit came from. Federation merges results via cross-store Reciprocal Rank Fusion (RRF k=60) rather than raw score comparison, eliminating the score-scale bias that would otherwise pin one store's results below another's when their underlying search methods produce scores in incompatible ranges (hybrid RRF ~0.03 vs vector-only ~0.85). A healthy primary + one broken linked store returns partial results with a per-query runtime warning; an entire-federation outage returns `isError: true` instead of masking as "no results found." Per-store reconnect+retry recovers from stale handles during concurrent `totem sync` rebuilds. Targeted `boundary: "<name>"` queries route only to that linked store. Strategy Proposal 215.
  - **LLM Context Caching — Opt-In Preview (#1292):** Anthropic `cache_control` markers wired through the orchestrator middleware for compile + review paths. Sliding TTL configurable via `cacheTTL`, constrained to the two values Anthropic supports natively: `300` (5 minutes, default ephemeral) or `3600` (1 hour, extended cache). The TTL resets on every cache hit, so bulk recompile runs stay warm end-to-end as long as operations land inside the active window. **Defaults to off in 1.14.0** — opt-in via `enableContextCaching: true` in `totem.config.ts` to avoid surprising existing users mid-cycle with a token-usage profile shift. Default activation tracked for 1.15.0 in mmnto/totem#1291. Anthropic-only in this release; Gemini `CachedContent` support tracked for 1.16.0+. Strategy Proposal 217. The full machinery (orchestrator middleware, schema field, TTL-literal validation, per-call cache metric tracking) ships in 1.14.0 — only the default-on behavior is deferred.
  - **Federation diagnostic hardening:** Dimension-mismatch diagnostic now persists across queries (one-shot is wrong when the underlying state is actively blocking — a single warning followed by cryptic LanceDB errors was worse than a persistent actionable message). One-shot first-query flags are only consumed after the gated operation actually succeeds, so transient `getContext` failures don't permanently suppress startup warnings. Linked-store init warnings (empty stores, name collisions, dimension mismatches) survive reconnect cycles intact — they represent static config state that a runtime reconnect can't fix.
  - **Collision-safe state:** Linked store name collisions (two paths deriving to the same basename) are keyed under the bare derived name in `linkedStoreInitErrors` so the `performSearch` boundary lookup can find them — earlier revisions used a descriptive composite key that was unreachable by any user-facing query. Primary store failures are tracked in a dedicated `FailureLog.primary` slot rather than overloading `'primary'` as a map key, which would have collided with legal link names (`deriveLinkName` strips leading dots, so a linked repo at `.primary/` derives to `'primary'`).
  - **Smoke test (#1295 Phase 3):** Standalone CLI integration test (`packages/mcp/dist/smoke-test.js`) exercises a real `ServerContext` against the current `totem.config.ts`, runs a federated query across primary + all linked stores, and emits a pass/fail verdict with per-store hit counts and top-N formatted results. Used as the empirical proof for the PR #1295 body; repurposable for any future cross-repo validation.
  - **19 lessons extracted** from the 1.14.0 PR arc (#1292, #1295, #1296); 1 new compiled rule via local Sonnet (394 total, up from 393). 18 lessons skipped as architectural/conceptual — tracked as `nonCompilable` tuples for doctor triage. Most of the architectural 1.14.0 learnings (silent-drift anti-patterns, reserved-key collisions, session-vs-per-request state confusion, failure-modes-table-as-design-review-tool) are non-compilable by nature but live in `.totem/lessons/` as referenceable architectural patterns. (The initial compile pass produced 2 rules; the delimiter-cache-key rule was reframed as architectural after both bots caught a malformed ast-grep pattern that the LLM produced twice in a row — Tenet 4 says broken rules should not ship, so the lesson now lives as documentation only.)
  - **2722 tests** across core + cli + mcp (up from 2580 at the start of the 1.14.0 cycle).

### Patch Changes

- Updated dependencies [11ab03b]
  - @mmnto/totem@1.14.0

## 1.13.0

### Patch Changes

- Updated dependencies [0b08629]
  - @mmnto/totem@1.13.0

## 1.12.0

### Patch Changes

- Updated dependencies [c4f9746]
  - @mmnto/totem@1.12.0

## 1.11.0

### Minor Changes

- 33039d1: 1.11.0 — The Import Engine

  Rule portability across tools, compiler safety, and thick baseline language packs.
  - **Proactive Language Packs (#1152):** 50 baseline rules (up from 23) across TypeScript, Node.js Security, and Shell/POSIX. Sourced from @typescript-eslint, OWASP, and ShellCheck best practices.
  - **Lesson Retirement Ledger (#1165):** `.totem/retired-lessons.json` tracks intentionally removed rules, preventing re-extraction during future import cycles.
  - **Compiler Guard (#1177):** Rejects self-suppressing patterns (totem-ignore, totem-context, shield-context) at compile time.
  - **ESLint Syntax/Properties (#1140):** `totem import --from-eslint` now handles `no-restricted-properties` (dot, optional chaining, bracket notation) and `no-restricted-syntax` (ForInStatement, WithStatement, DebuggerStatement).
  - **Model Defaults (#1185):** `totem init` defaults updated to `claude-sonnet-4-6` (Anthropic) and `gpt-5.4-mini` (OpenAI).
  - **Supported Models Refresh:** Gemini 2.5 deprecation warning, gemma4/qwen3 for Ollama, new embedding models.

### Patch Changes

- Updated dependencies [33039d1]
  - @mmnto/totem@1.11.0

## 1.10.2

### Patch Changes

- 7b51599: Phase 2: Import Engine foundations
  - Lesson retirement ledger (.totem/retired-lessons.json) prevents re-extraction of intentionally removed rules
  - Compiler guard rejects self-suppressing patterns (totem-ignore/totem-context/shield-context)
  - ESLint adapter: no-restricted-properties (dot, optional chaining, bracket notation) and no-restricted-syntax (ForInStatement, WithStatement, DebuggerStatement) handlers
  - Model defaults updated: claude-sonnet-4-6 (Anthropic), gpt-5.4-mini (OpenAI)
  - Supported models reference refreshed (2026-04-04)

- Updated dependencies [7b51599]
  - @mmnto/totem@1.10.2

## 1.10.1

### Patch Changes

- @mmnto/totem@1.10.1

## 1.10.0

### Patch Changes

- @mmnto/totem@1.10.0

## 1.9.0

### Minor Changes

- 1650e51: 1.9.0 — Pipeline Engine milestone release

  Five pipelines for rule creation: P1 manual scaffolding, P2 LLM-generated, P3 example-based compilation, P4 ESLint/Semgrep import, P5 observation auto-capture. Docs, wiki, and playground updated to match.

### Patch Changes

- Updated dependencies [1650e51]
  - @mmnto/totem@1.9.0

## 1.8.5

### Patch Changes

- Updated dependencies [9a6a1a0]
  - @mmnto/totem@1.8.5

## 1.8.4

### Patch Changes

- Updated dependencies [1bb150d]
  - @mmnto/totem@1.8.4

## 1.8.3

### Patch Changes

- @mmnto/totem@1.8.3

## 1.8.2

### Patch Changes

- Updated dependencies [11f4512]
  - @mmnto/totem@1.8.2

## 1.8.1

### Patch Changes

- Updated dependencies [f088d68]
- Updated dependencies [f088d68]
  - @mmnto/totem@1.8.1

## 1.8.0

### Patch Changes

- Updated dependencies [4d87c56]
  - @mmnto/totem@1.8.0

## 1.7.2

### Patch Changes

- Updated dependencies [8fe2329]
  - @mmnto/totem@1.7.2

## 1.7.1

### Patch Changes

- @mmnto/totem@1.7.1

## 1.7.0

### Patch Changes

- @mmnto/totem@1.7.0

## 1.6.3

### Patch Changes

- @mmnto/totem@1.6.3

## 1.6.2

### Patch Changes

- @mmnto/totem@1.6.2

## 1.6.1

### Patch Changes

- fix: pipeline fixes, compiler DX improvements, and shield auto-refresh
  - Shield flag auto-refresh on pre-push — no more stale flag after every commit (#1045)
  - Bot source enum in LedgerEvent for accurate exemption tracking (#1048)
  - Thread context propagation for reliable PR comment replies (#1051)
  - Shield false positive fix on synchronous adapter methods (#1058)
  - Compiler transparency — `totem compile --verbose` shows why lessons are skipped (#1060)
  - Zero-match rule detection in lint output (#1061)
  - Compile-time validation for ast-grep patterns (#1062)
  - Hardened hook upgrade tests (#1068)

- Updated dependencies
  - @mmnto/totem@1.6.1

## 1.6.0

### Minor Changes

- 069d652: feat: 1.6.0 — Pipeline Maturity

  Exemption Engine (#917):
  - Dual-storage false positive tracking (local gitignored + shared committed)
  - 3-strike auto-promotion to team-wide suppressions
  - --suppress flag for manual pattern suppression
  - Bot review pushback → exemption tracking via extractPushbackFindings
  - Ledger 'exemption' event type for full audit trail

  Auto-ticket Deferred (#931):
  - createDeferredIssue service with idempotency and thread reply
  - inferNextMilestone for semver-aware milestone assignment
  - PrAdapter: createIssue, replyToComment, addPrComment

  Interactive Triage CLI (#958):
  - totem triage-pr --interactive / -i with Clack prompts
  - Per-finding actions: Fix, Defer, Dismiss, Learn, Skip
  - TTY guard, isCancel on every prompt, confirm preview

  Agent Dispatch (#957):
  - dispatchFix: LLM-powered code fix with atomic commit and thread reply
  - Path traversal guard, git rollback on failure
  - Bot re-trigger: /gemini-review after fixes

  Bot-to-Lesson Loop (#959):
  - "Learn" action saves findings as lessons with bot-review tags
  - Post-triage review-learn prompt for batch extraction

### Patch Changes

- Updated dependencies [069d652]
  - @mmnto/totem@1.6.0

## 1.5.11

### Patch Changes

- Updated dependencies [7cd543a]
  - @mmnto/totem@1.5.11

## 1.5.10

### Patch Changes

- 990c3bf: Incremental shield, totem status/check, docs staleness fix.
  - feat: incremental shield validation — delta-only re-check for small fixes (#1010)
  - feat: totem status + totem check commands (#951)
  - fix: totem docs staleness — aggressive rewrite of stale roadmap sections (#1024)
  - fix: mermaid lexer error in architecture diagram
  - chore: MCP add_lesson rate limit bumped to 25 per session
  - chore: 364 compiled rules, 966 lessons, 2,000 tests

- Updated dependencies [990c3bf]
  - @mmnto/totem@1.5.10

## 1.5.9

### Patch Changes

- 59a605c: Pipeline integrity fixes, docs storefront rewrite, COSS covenant.
  - fix: MCP spawn ENOENT on Windows — env + shell options (#1023)
  - fix: triage-pr and review-learn surface outside-diff findings (#984)
  - feat: lesson linter semantic heuristics + --strict flag (#1013)
  - docs: README storefront rewrite with flywheel diagram
  - docs: workflow wiki pages (learning loop, self-healing, agent governance)
  - docs: COSS covenant and maintainer policy
  - chore: 354 compiled rules, 953 lessons

- Updated dependencies [59a605c]
  - @mmnto/totem@1.5.9

## 1.5.8

### Patch Changes

- Shield hardening, rule unit testing, and bug bundle
  - Rule unit testing: `**Example Hit:**`/`**Example Miss:**` in lesson markdown verified at compile time
  - Shield context enrichment: full file content for small changed files reduces LLM false positives
  - Shield `--override <reason>`: audited bypass for false positives, logged to trap ledger
  - safeExec: forced pipe mode, type-safe return, removed unsafe `as string` cast
  - gh-utils: error unwrapping matches safeExec error chain structure
  - GH_PROMPT_DISABLED added to all direct gh invocations
  - Hook paths resolved from git root, not cwd
  - Hook regex tightened to match git subcommand only (not filenames)
  - jq for JSON parsing in pre-push hook with grep/sed fallback
  - Agent worktree scratchpads excluded from prettier
  - Compile-after-extract ritual added to CLAUDE.md

- Updated dependencies
  - @mmnto/totem@1.5.8

## 1.5.7

### Patch Changes

- Codebase audit remediation and foundation hardening
  - New `core/src/sys/` standard library: `safeExec()`, `readJsonSafe()`, git adapter (13 functions moved from CLI to core)
  - Error cause chains (ES2022): TotemError hierarchy accepts `cause`, 22 catch blocks updated
  - Forbidden native module rules: 3 compiled rules enforce shared helper usage
  - Phase-gate hooks hardened: `fix/*` exemption removed, warning upgraded to block
  - CoreLogger DI: `setCoreLogger()` replaces `console.warn` in core
  - CRLF fixed: `.gitattributes` forces LF, prettier `endOfLine: "lf"`
  - Shield flag verify-not-consume: push no longer deletes the flag
  - AST query graceful degradation: tree-sitter failures no longer crash compilation
  - Spec gap remediation: `cleanTmpDir` helper, CLI wiring fixes

- Updated dependencies
  - @mmnto/totem@1.5.7

## 1.5.6

### Patch Changes

- fc607ce: ### 1.5.6 — Foundation & Hardening

  **Features:**
  - Unified Findings Model (`TotemFinding`) — common output schema for lint and shield (ADR-071)
  - `totem-context:` is now the primary override directive; `shield-context:` remains as silent alias
  - `totem lint --format json` now includes a `findings[]` array alongside `violations[]`
  - safe-regex validation for user-supplied DLP patterns — ReDoS-vulnerable patterns rejected at input time

  **Fixes:**
  - `matchesGlob()` now correctly handles `*.test.*` and `dir/*.test.*` patterns (was doing literal string match)
  - `readRegistry()` differentiates ENOENT from permission/parse errors via `onWarn` callback
  - `TotemParseError` used for schema validation failures (was generic `Error`)
  - Git hooks path resolved via `git rev-parse --git-path` (supports worktrees and custom `core.hooksPath`)
  - `shield-hints.ts` uses `log.dim()` instead of raw ANSI escape codes
  - `store.count()` failure no longer breaks sync
  - `maxBuffer` (10MB) added to git diff commands — prevents ENOBUFS on large branch diffs
  - Windows `ENOTEMPTY` flake fixed with `maxRetries` in test cleanup

  **Chores:**
  - Dynamic imports in `doctor.ts` for startup latency
  - 8 new lessons extracted from bot reviews (305 compiled rules)
  - Audited and removed 6 `totem-ignore` suppressions
  - Updated compiled baseline hash and scope for JSON.parse rule

- Updated dependencies [fc607ce]
  - @mmnto/totem@1.5.6

## 1.5.5

### Patch Changes

- Updated dependencies [19de6b1]
  - @mmnto/totem@1.5.5

## 1.5.4

### Patch Changes

- Updated dependencies [7f5d4e7]
  - @mmnto/totem@1.5.4

## 1.5.3

### Patch Changes

- ### Shield Redesign — Structured Verdicts + Deterministic Fast-Path (#910)
  - Three-stage pipeline: file classification → hybrid diff filtering → Zod-validated JSON findings
  - Non-code diffs (docs, YAML, config) skip LLM entirely for instant PASS
  - Severity levels (CRITICAL/WARN/INFO) with deterministic pass/fail — LLM no longer decides the gate
  - V1 regex fallback for custom `.totem/prompts/shield.md` overrides

  ### Compile Pipeline Reliability (#939, #941)
  - Pre-push hook auto-verifies compile manifest; auto-compiles if stale then aborts push
  - `totem lint` emits non-blocking staleness warning when manifest is out of date
  - Compiler normalizes shallow fileGlobs (`*.ts` → `**/*.ts`) for external tool compatibility
  - `sanitizeFileGlobs` guards against non-string and empty entries

  ### CLI Performance (#943)
  - Converted ~90 static imports to dynamic `await import()` across 25 command files
  - Heavy modules only loaded when the specific command is executed
  - Startup latency reduced for lightweight operations (`--help`, `--version`)

  ### Error Logging (#849)
  - Standardized `[Totem Error]` prefix across all CLI error output
  - `handleError` now consistently tags errors with guard against double-prefixing

- Updated dependencies
  - @mmnto/totem@1.5.3

## 1.5.0

### Minor Changes

- Updated dependencies
  - @mmnto/totem@1.5.0

## 1.4.3

### Patch Changes

- DX hardening, core refactor, and docs overhaul.

  **Core:**
  - Extract `buildCompiledRule()`, `buildManualRule()`, `compileLesson()` to core package — eliminates duplicated rule-building logic between local and cloud compilation paths

  **CLI:**
  - Reduce pre-push hook verbosity: dot reporter by default, full output on failure, `TOTEM_DEBUG=1` for verbose mode
  - Suppress gh CLI stderr leak in multi-repo issue fetch
  - Extract shared `ghExecOptions()` with `GH_PROMPT_DISABLED=1` to prevent interactive auth hangs
  - Protect `<manual_content>` blocks from `stripMarketingTerms` mutation

  **Config:**
  - Remove `**/*.test.ts` from `ignorePatterns` so shield can see test files in diffs

  **Docs:**
  - Rewrite README as technical spec sheet (~130 lines, zero marketing)
  - Create SECURITY.md with full 1.4.x audit
  - Scaffold `docs/wiki/` with enforcement model, MCP setup, cross-repo mesh, troubleshooting
  - Add 6 placeholder wiki pages for 1.5.0 features

- Updated dependencies
  - @mmnto/totem@1.4.3

## 1.4.2

### Patch Changes

- f1509d3: Post-1.4.0 quality sweep (Proposal 189): security fixes, broken functionality, 154 new tests, quality hardening, DRY cleanup, and compile manifest CI attestation
- Updated dependencies [f1509d3]
  - @mmnto/totem@1.4.2

## 1.4.1

### Patch Changes

- ec5b807: Security sweep: fix sanitizer regex statefulness (#871), secret pattern ordering (#872), extract parser injection vector (#873), SQL escaping (#874), and add compile manifest CI attestation (#875)
- Updated dependencies [ec5b807]
  - @mmnto/totem@1.4.1

## 1.4.0

### Minor Changes

#### Security Hardening

### Core (`@mmnto/totem`)

- **AST engines fail-closed** — query/parse errors now throw `TotemParseError` instead of silently returning empty arrays (#848)
- **Compile manifest signing** — `totem compile` writes `.totem/compile-manifest.json` with SHA-256 provenance chain (#842)
- **XML trust boundaries** — new `wrapUntrustedXml()` for network-fetched content, existing `wrapXml()` preserved for trusted local diffs (#843)
- **Tag name validation** — both XML wrappers validate tag names against injection (#843)
- **DLP secret masking** — `maskSecrets()` utility with centralized `rethrowAsParseError` and `getErrorMessage` helpers (#848, #strategy-12)
- **247 compiled rules** (up from 230)

### CLI (`@mmnto/cli`)

- **Wind tunnel SHA lock** — `tools/update-wind-tunnel-sha.sh` with CI verification job (#840)
- **`totem verify-manifest`** — zero-LLM CI command to verify compiled rules match source lessons (#842)
- **Docs confirmation gate** — `totem docs` requires interactive confirmation or `--yes` before writing LLM output (#847)
- **Marketing term stripping** — case-preserving deterministic replacement, preserves code blocks and URLs (#833)
- **DLP middleware** — `maskSecrets` runs before every outbound LLM call, bypasses local providers (#strategy-12)

### MCP (`@mmnto/mcp`)

- **add_lesson auth model** — Zod schema validation, rate limiting (10/session), source provenance, heading sanitization (#844)

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.4.0

## 1.3.19

### Patch Changes

- feat: markdown-magic deterministic doc injection
  - Integrated markdown-magic with 4 transforms (RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE)
  - Wired docs:inject into totem wrap pipeline (step 5/6, after LLM docs, before compile)
  - 9 unit tests for transforms, runs in 0.02s
  - Eliminates stale hardcoded values in docs across releases

- Updated dependencies
  - @mmnto/totem@1.3.19

## 1.3.18

### Patch Changes

- feat: invisible sync hooks (ADR-066)
  - Post-merge hook only syncs when `.totem/lessons/` files change (git diff-tree conditional)
  - New post-checkout hook syncs on branch switch when `.totem/` differs
  - `totem sync --quiet` flag for silent background hook execution
  - Deterministic end markers for safe eject scrubbing
  - DRY scrubHook helper with try/catch and exact marker matching
  - 230 compiled rules (19 new), 697 lessons

- Updated dependencies
  - @mmnto/totem@1.3.18

## 1.3.17

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.17

## 1.3.16

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.16

## 1.3.15

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.15

## 1.3.14

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.14

## 1.3.13

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.13

## 1.3.12

### Patch Changes

- Updated dependencies
  - @mmnto/totem@1.3.12

## 1.3.11

### Patch Changes

- 0b47c94: Security hardening: regex escape, shell:true removal, SQL backtick escape. CodeRabbit integration with path instructions. onWarn logging for AST catch blocks. Unsafe non-null assertions replaced.
- Updated dependencies [0b47c94]
  - @mmnto/totem@1.3.11

## 1.3.10

### Patch Changes

- Updated dependencies [ceb8663]
  - @mmnto/totem@1.3.10

## 1.3.9

### Patch Changes

- 48cd644: Named index partitions for context isolation. Backfilled body text for 125 Pipeline 1 lessons. Consolidated near-duplicate rules (146 → 144).
- Updated dependencies [48cd644]
  - @mmnto/totem@1.3.9

## 1.3.8

### Patch Changes

- 16e6071: Context isolation boundary parameter for search_knowledge MCP tool. Consolidated near-duplicate rules (146 → 144).
- Updated dependencies [16e6071]
  - @mmnto/totem@1.3.8

## 1.3.7

### Patch Changes

- Updated dependencies [6a2eb4c]
  - @mmnto/totem@1.3.7

## 1.3.6

### Patch Changes

- Updated dependencies [09153f8]
  - @mmnto/totem@1.3.6

## 1.3.5

### Patch Changes

- Updated dependencies [5810bcc]
  - @mmnto/totem@1.3.5

## 1.3.4

### Patch Changes

- Updated dependencies [98d56dc]
  - @mmnto/totem@1.3.4

## 1.3.3

### Patch Changes

- @mmnto/totem@1.3.3

## 1.3.2

### Patch Changes

- 5aeb86d: ### DX Polish
  - Post-init message for Lite users now dares them to test the engine: "Write an empty `catch(e) {}` block and run `npx totem lint`"
  - Hidden legacy commands (`install-hooks`, `demo`, `migrate-lessons`) from `--help` output
  - Clean `totem lint` PASS is now one line instead of six
  - Added launch metrics to README (3-layer gate, 1.75s benchmark)
  - Unix process group cleanup for lint timeout handler (prevents zombie processes)
  - @mmnto/totem@1.3.2

## 1.3.1

### Patch Changes

- ace02c0: ### Bug Fixes
  - **Critical:** Fixed filter ordering in `totem lint` and `totem shield` — ignored patterns (e.g., `.strategy` submodule) were checked after the emptiness test, preventing branch-diff fallback from firing. The Layer 3 pre-push gate was silently passing. (#709)
  - Fixed latent bug where AST rules with empty `pattern` fields could match every line when passed to the regex executor (#710)
  - Replaced 13 raw `throw new Error()` calls with typed `TotemError` subclasses across core and CLI packages (#711)

  ### Improvements
  - **Compiler facade refactor:** Split `compiler.ts` (600 lines) into focused modules — `compiler-schema.ts`, `diff-parser.ts`, `rule-engine.ts` — with `compiler.ts` as a clean coordinator. Public API unchanged. (#710)
  - Added `TOTEM_DEBUG=1` env var for full stack traces during troubleshooting (#711)
  - Added mandatory verify steps (lint + shield + verify_execution) to `totem spec` output (#708)
  - Reverted to curated 147-rule set and added 59 lesson hashes to nonCompilable blocklist (#708)

- Updated dependencies [ace02c0]
  - @mmnto/totem@1.3.1

## 1.3.0

### Minor Changes

- a02f7f8: Release 1.3.0 — MCP verify_execution, spec inline invariants, baseline Fix guidance.

  ### Highlights
  - **MCP `verify_execution` tool**: AI agents can now mathematically verify their work before declaring a task done. Runs `totem lint` as a child process and returns pass/fail with violation details. Supports `staged_only` flag. Warns about unstaged changes.
  - **Spec inline invariant injection**: `totem spec` now outputs granular implementation tasks with Totem lessons injected directly into the steps where they apply. Closes the gap between "planning" and "doing."
  - **Baseline Fix suggestions**: 24 of 59 universal baseline lessons updated with explicit "Fix:" guidance. Every lesson now tells developers what TO do, not just what to avoid.

### Patch Changes

- Updated dependencies [a02f7f8]
  - @mmnto/totem@1.3.0

## 1.2.0

### Patch Changes

- baf6e15: Release 1.2.0 — ast-grep engine, compound rules, and shield CI hardening.

  ### Highlights
  - **ast-grep pattern engine**: Third rule engine alongside regex and Tree-sitter. Patterns look like source code (`process.env.$PROP`, `console.log($ARG)`) — dramatically easier for LLMs to generate accurately.
  - **ast-grep compound rules**: Full support for `has`/`inside`/`follows`/`not`/`all`/`any` operators via NapiConfig rule objects. Enables structural rules like "useEffect without cleanup."
  - **Shield CI hardening**: `shieldIgnorePatterns` now filters the diff before linting, preventing `.strategy` submodule pointer changes from triggering false CI failures.
  - **Dynamic import rules narrowed**: Code scanning alerts for dynamic imports in command files eliminated — rules now only apply to core/adapter code.
  - **Case-insensitive hash matching**: `totem explain` and `totem test --filter` now match regardless of case.
  - **README hardened**: Staff Engineer red team feedback addressed — deterministic enforcement, air-gapped operation, and git-committed artifacts all clarified.
  - **Docs injection scoped**: Manual content injection now targets README only, not all docs.

- Updated dependencies [baf6e15]
  - @mmnto/totem@1.2.0

## 1.1.0

### Minor Changes

- 4c0b2cd: Release 1.1.0 — Tier 2 AST engine, cross-totem queries, and totem explain.

  ### Highlights
  - **Tier 2 AST engine**: Compiled rules now support Tree-sitter S-expression queries alongside regex. Enables structural rule matching that regex alone can't express.
  - **Cross-totem queries**: New `linkedIndexes` config lets `totem spec` query knowledge from other totem-managed directories (e.g., strategy repos, design docs) alongside the primary project index.
  - **totem init --bare**: Zero-config initialization for non-code repositories — notes, docs, ADRs, infrastructure configs. No package.json required.
  - **totem explain**: Look up the full lesson behind any compiled rule violation. Supports partial hash prefix matching. Zero LLM, instant.
  - **TODO guardrail rules**: 3 new baseline rules catch `// TODO: implement` stubs, `throw new Error("Not implemented")`, and empty catch blocks. Baseline now ships 15 pre-compiled rules.
  - **Dimension mismatch detection**: `totem sync` writes `index-meta.json`. Switching embedding providers without rebuilding the index now throws a clear error instead of silently returning garbage results.
  - **Compiled rules reverted to curated set**: The 147 hand-audited rules are preserved. Blind recompilation with Flash produced regressions — compiler improvements tracked in #670.

### Patch Changes

- Updated dependencies [4c0b2cd]
  - @mmnto/totem@1.1.0

## 1.0.0

### Major Changes

- d49cdbf: Release 1.0.0 — Totem is production-ready.

  ### Highlights
  - **Zero-config lint protection**: `totem init` now ships 13 pre-compiled universal baseline rules. Every user gets deterministic lint protection from Day 1 — no API keys, no LLM calls required.
  - **Filesystem concurrency locks**: Sync and MCP mutations are now protected by PID-aware file locks with signal cleanup (SIGINT, SIGTERM, SIGHUP, SIGQUIT).
  - **Portability audit**: CLI help grouped by tier, `requireGhCli()` guard on GitHub commands, dynamic orchestrator detection, configurable bot markers, expanded issue URL regex for GitLab/self-hosted.
  - **TotemError consistency**: All error paths use structured `TotemError` hierarchy with recovery hints. Ollama model-not-found errors give actionable `ollama pull` instructions.
  - **MCP race condition fix**: `getContext()` uses promise memoization to prevent duplicate connections from concurrent callers, with retry on transient failures.
  - **Compiled rule audit**: 148 → 147 rules, 0 undefined severity, false positives on TotemError/type imports/stdlib imports eliminated.
  - **Manual docs survive regeneration**: `docs/manual/` content is injected verbatim into `totem docs` output.

### Patch Changes

- Updated dependencies [d49cdbf]
  - @mmnto/totem@1.0.0

## 0.44.0

### Patch Changes

- ab254bf: feat: migrate 54 throw sites to TotemError hierarchy

  Every error now includes a `recoveryHint` telling the user exactly how to fix it. New error classes: `TotemOrchestratorError`, `TotemGitError`. New error code: `GIT_FAILED`. Includes rule fix exempting error class imports from the static import lint rule.

- Updated dependencies [ab254bf]
  - @mmnto/totem@0.44.0

## 0.43.0

### Patch Changes

- @mmnto/totem@0.43.0

## 0.42.0

### Patch Changes

- 557d046: feat: DLP secret masking — strip secrets before embedding (#534)

  Automatically masks API keys, tokens, passwords, and credentials with [REDACTED] before entering LanceDB. Preserves key names in assignments. Handles quoted and unquoted patterns.

  fix: compiler glob patterns — prompt constraints + brace expansion (#602)

  Compiler prompt now forbids unsupported glob syntax. Post-compile sanitizer expands brace patterns. Fixed 12 existing rules.

  fix: init embedding detection — Gemini first (#551)

  Reorders provider detection to prefer Gemini (task-type aware) over OpenAI when both keys present.

  fix: review blitz 2 — dynamic imports, onWarn, rule demotions (#575, #594, #595)

  compile.ts dynamic imports, loadCompiledRules onWarn callback, err.message rule demoted to warning.

  docs: Scope & Limitations section, Solo Dev Litmus Test styleguide rule

- Updated dependencies [557d046]
  - @mmnto/totem@0.42.0

## 0.41.0

### Patch Changes

- 028786b: perf: cache non-compilable lessons to skip recompilation (#590)

  `totem compile` now caches lesson hashes that the LLM determined cannot be compiled. Subsequent runs skip them instantly. `totem wrap` goes from ~15 min to ~30 seconds.

  fix: remove duplicate compiled rule causing false positives (#589)

  Root cause was duplicate rules from compile, not a glob matching bug. Removed the broad duplicate.

  feat: auto-ingest cursor rules during totem init (#596)

  `totem init` scans for .cursorrules, .mdc, and .windsurfrules. If found, prompts user to compile them into deterministic invariants.

  fix: strip known-not-shipped issue refs from docs generation (#598)

  Ends the #515 hallucination that recurred in 5 consecutive releases. Pre-processing strips from git log, post-processing strips from LLM output.

- Updated dependencies [028786b]
  - @mmnto/totem@0.41.0

## 0.40.0

### Patch Changes

- 99f8995: feat: .mdc / .cursorrules ingestion adapter (#555)

  New `totem compile --from-cursor` flag. Scans .cursor/rules/\*.mdc, .cursorrules, and .windsurfrules files. Parses frontmatter and plain text rules. Compiles them into deterministic Totem rules via the existing LLM pipeline.

  docs: README Holy Grail positioning (ADR-049)

  "A zero-config CLI that compiles your .cursorrules into deterministic CI guardrails. Stop repeating yourself to your AI." MCP as step 2, Solo Dev Superpower section, command table with speed metrics.

- Updated dependencies [99f8995]
  - @mmnto/totem@0.40.0

## 0.39.0

### Patch Changes

- dda8715: feat: shield severity levels — error vs warning (#498)

  Rules now support `severity: 'error' | 'warning'`. Errors block CI, warnings inform but pass. SARIF output maps severity to the `level` field. JSON output includes error/warning counts.

  chore: rule invariant audit — 137 rules categorized (#556)

  27 security (error), 56 architecture (error), 47 style (warning), 7 performance (warning). 39% reduction in hard blocks while maintaining all guidance.

  fix: auto-healing DB — dimension mismatch + version recovery (#500, #548)

  LanceStore.connect() auto-heals on embedder dimension mismatch and LanceDB version/corruption errors. Nukes .lancedb/ and reconnects empty for a clean rebuild.

- Updated dependencies [dda8715]
  - @mmnto/totem@0.39.0

## 0.38.0

### Patch Changes

- 89fcb02: feat: Trap Ledger Phase 1 — SARIF extension + enhanced totem stats

  Every `totem lint` violation now generates SARIF properties with eventId, ruleCategory, timestamp, and lessonHash. Rules support a `category` field (security/architecture/style/performance). `totem stats` shows "Total violations prevented" with category breakdown and top 10 prevented violations.

  fix: code review blitz — 7 findings from Claude+Gemini synthesis

  Critical: MCP loadEnv quote stripping, add_lesson race condition (promise memoization), SARIF format flag works with totem lint. High: extracted shared runCompiledRules (-75 lines), Gemini default model fixed, health check --rebuild → --full, lesson validation before disk write.

  fix: stale prompts — docs glossary, init model, reflex block v3

  Command glossary in docs system prompt prevents LLM confusing lint/shield. Gemini embedder model corrected in init. AI_PROMPT_BLOCK distinguishes lint (pre-push) from shield (pre-PR).

  chore: 137 compiled rules (39 new), 17 extracted lessons, docs sync

- Updated dependencies [89fcb02]
  - @mmnto/totem@0.38.0

## 0.37.0

### Patch Changes

- 382c77a: feat: `totem lint` — new command for fast compiled rule checks (zero LLM)

  Split from `totem shield`. `totem lint` runs compiled rules against your diff in ~2 seconds with no API keys needed. `totem shield` is now exclusively the AI-powered code review. `--deterministic` flag is deprecated with a warning.

  feat: semantic rule observability (Phase 1)

  Rules now track `createdAt`, `triggerCount`, `suppressCount`, and `lastTriggeredAt` metadata. `totem stats` displays rule metrics. Foundation for automated rule decay analysis.

  fix: shield rule scoping — dynamic import and match/exec rules narrowed

  Dynamic import rule scoped to command files only (not adapters/orchestrators). match/exec rule scoped to security-sensitive code only. `.cjs` rule excludes CI workflow YAML.

- Updated dependencies [382c77a]
  - @mmnto/totem@0.37.0

## 0.36.0

### Patch Changes

- 74e521e: feat: graceful degradation for orchestrator and embedder providers

  Orchestrators (Gemini, Anthropic) now fall back to their CLI equivalents when the SDK or API key is missing. Embedders fall back to Ollama when the configured provider is unavailable. LazyEmbedder uses promise memoization to prevent race conditions with concurrent embed() calls.

  feat: configurable issue sources — support multiple repos in triage/extract/spec

  Add `repositories` field to `totem.config.ts`. When set, triage, audit, and spec commands aggregate issues from all listed repos. Supports `owner/repo#123` syntax for disambiguation.

  chore: switch default embedder to Gemini (gemini-embedding-2-preview)

  Task-type aware 768d embeddings replace OpenAI text-embedding-3-small (1536d). Requires `totem sync --full` after upgrade.

- Updated dependencies [74e521e]
  - @mmnto/totem@0.36.0

## 0.35.1

### Patch Changes

- Updated dependencies [9cd061e]
  - @mmnto/totem@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [f6074c4]
  - @mmnto/totem@0.35.0

## 0.34.0

### Patch Changes

- @mmnto/totem@0.34.0

## 0.33.1

### Patch Changes

- 7a90a44: Bug fixes: Gemini embedder dimension mismatch detection, shell orchestrator process leak on Windows.
  - **MCP:** Detect embedding dimension mismatch on first query and return clear error message with fix instructions (rebuild index + restart MCP server)
  - **CLI:** Fix shell orchestrator process leak on Windows — use `taskkill /T` to kill entire process tree on timeout instead of just the shell wrapper
  - **CLI:** `totem demo` command for previewing spinner animations
  - @mmnto/totem@0.33.1

## 0.33.0

### Minor Changes

- a91ca10: Agent hooks, rule testing harness, multi-domain MCP, and docs migration.
  - **CLI:** `totem test` command — TDD harness for compiled shield rules with pass/fail fixtures
  - **CLI:** Agent hooks reinstated — Claude PreToolUse shield gate, Gemini SessionStart + BeforeTool
  - **CLI:** Instruction file length enforcement (FR-C01, <50 lines)
  - **Core:** `parseFixture()`, `testRule()`, `runRuleTests()` — rule testing engine
  - **Core:** Export `matchesGlob` for shield file filtering
  - **MCP:** `--cwd` flag for multi-domain knowledge architecture (strategy Totem)
  - **MCP:** Robust `--cwd` validation with `[Totem Error]` prefix
  - **Shield:** `shieldIgnorePatterns` config field (separate from sync ignorePatterns)
  - **Shield:** Compiled rules respect ignorePatterns from config
  - **Shield:** execSync rule scoped to exclude hook scripts
  - **Shield:** Literal-file-path rule scoped to lesson files only (#457)
  - **Docs:** README-to-wiki migration — marketing-lean README + 5 new wiki pages
  - **Config:** Consumer hook templates use `--deterministic` shield

### Patch Changes

- Updated dependencies [a91ca10]
  - @mmnto/totem@0.33.0

## 0.32.0

### Patch Changes

- bd40894: Agent config cleanup, shield ignorePatterns separation, and Junie support.
  - **Shield:** `shieldIgnorePatterns` config field separates shield exclusions from sync indexing
  - **Shield:** Deterministic shield now respects `ignorePatterns` from config
  - **Core:** Export `matchesGlob` for shield file filtering
  - **Init:** Fix Gemini CLI reflexFile path (`.gemini/gemini.md` → `GEMINI.md`)
  - **Init:** Export `AI_PROMPT_BLOCK` for drift test consumption
  - **MCP:** Replace empty catch blocks with `logSearch()` disk-based diagnostics
  - **Config:** Add `shieldIgnorePatterns` to config schema
  - **Junie:** Lean guidelines.md, correct MCP path (`.junie/mcp/mcp.json`), compiled rules as skill
  - **Drift Tests:** 41-assertion config drift test suite guarding hooks, agent configs, MCP scaffolding, and secrets

- Updated dependencies [bd40894]
  - @mmnto/totem@0.32.0

## 0.31.0

### Minor Changes

- feat: hybrid search (FTS + vector with RRF reranking), Gemini embedding provider, retrieval eval script
- feat: lessons directory migration — dual-read/single-write (per-file lessons replace monolithic lessons file)

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @mmnto/totem@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [d0be9c6]
  - @mmnto/totem@0.30.0

## 0.29.0

### Patch Changes

- e311aff: Lesson injection into all orchestrator commands, totem audit, and Junie docs.
  - **`totem audit`** — strategic backlog audit with human approval gate, interactive multi-select, shell injection prevention via `--body-file`, resilient batch execution (#362)
  - **Lesson injection** — vector DB lessons now injected into shield (full bodies), triage (condensed), and briefing (condensed) via shared `partitionLessons()` + `formatLessonSection()` helpers (#370)
  - **Junie docs** — MCP config example and export target docs in README (#371)
  - **Lesson ContentType** — `add_lesson` MCP tool now uses `lesson` content type for better vector DB filtering (#377)
  - **Versioned reflex upgrade** — `REFLEX_VERSION=2` with `detectReflexStatus()` and `upgradeReflexes()` for existing consumers (#375)
  - **Spec lesson injection** — lessons injected as hard constraints into `totem spec` output (#366)

- Updated dependencies [e311aff]
  - @mmnto/totem@0.29.0

## 0.28.0

### Minor Changes

- d221d54: Extraction Hardening: semantic dedup for `totem extract`, dangling-tail heading cleanup, submodule-aware file resolver, and CLI `--help` fix.

### Patch Changes

- Updated dependencies [d221d54]
  - @mmnto/totem@0.28.0

## 0.27.0

### Minor Changes

- 20c912d: feat: saga validator for `totem docs` — deterministic post-update validation catches LLM hallucinations (checkbox mutations, sentinel corruption, frontmatter deletion, excessive content loss) before writing to disk (#356)

  fix: scope deterministic shield rules with fileGlobs — 21 of 24 compiled rules now have package-level glob scoping, preventing MCP-specific rules from firing against the entire codebase. Also fixes `matchesGlob` to support directory-prefixed patterns like `packages/cli/**/*.ts` (#357)

### Patch Changes

- Updated dependencies [20c912d]
  - @mmnto/totem@0.27.0

## 0.26.1

### Patch Changes

- @mmnto/totem@0.26.1

## 0.26.0

### Patch Changes

- @mmnto/totem@0.26.0

## 0.25.0

### Patch Changes

- 0455d24: Adversarial ingestion scrubbing, eval harness, Bun support, and model audit
  - **Adversarial ingestion scrubbing:** `sanitizeForIngestion()` strips BiDi overrides (Trojan Source defense) from all content types and invisible Unicode from prose chunks. Suspicious patterns flagged via `onWarn` but never stripped. Detection regexes consolidated into core for DRY reuse. XML tag regex hardened against whitespace bypass.
  - **Adversarial evaluation harness:** Integration tests with planted architectural violations for model drift detection. Deterministic tests run without API keys; LLM tests gated behind `CI_INTEGRATION=true` for nightly runs against Gemini, Anthropic, and OpenAI.
  - **Bun support:** `detectTotemPrefix()` checks for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2). Priority: pnpm > yarn > bun > npx.
  - **Model audit:** Updated default orchestrator model IDs — Anthropic to `claude-sonnet-4-6`, OpenAI to `gpt-5.4`/`gpt-5-mini`.
  - **Supported models doc:** New `docs/supported-models.md` with provider model listing APIs and discovery scripts.

- Updated dependencies [0455d24]
  - @mmnto/totem@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [3b8e53b]
  - @mmnto/totem@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [83923f0]
  - @mmnto/totem@0.23.0

## 0.22.0

### Minor Changes

- b3a07b8: ### 0.22.0 — AST Gating, OpenAI Orchestrator, Security Hardening

  **New Features**
  - **Tree-sitter AST gating** for deterministic shield — reduces false positives by classifying diff additions as code vs. non-code (#287)
  - **Generic OpenAI-compatible orchestrator** — supports OpenAI API, Ollama, LM Studio, and any OpenAI-compatible local server via BYOSD pattern (#285, #293)
  - **`totem handoff --lite`** — zero-LLM session snapshots with ANSI-sanitized git output (#281, #288)
  - **CI drift gate** with adversarial evaluation harness (#280)
  - **Concise lesson headings** — shorter, more searchable headings from extract (#271, #278)

  **Security Hardening**
  - Extract prompt injection hardening with explicit SECURITY NOTICE for untrusted PR fields (#279, #289, #295)
  - Path containment checks in drift detection to prevent directory traversal (#284)
  - ANSI terminal injection sanitization in handoff and git metadata (#292)

  **Bug Fixes**
  - GCA on-demand review configuration fixes (#278, #282)
  - GitHub Copilot lesson export confirmed working via existing `config.exports` (#294)

### Patch Changes

- Updated dependencies [b3a07b8]
  - @mmnto/totem@0.22.0

## 0.21.0

### Minor Changes

- e252d41: ### New Features
  - **`totem shield --mode=structural`** — Context-blind code review that catches syntax-level bugs (asymmetric validation, copy-paste drift, brittle tests, off-by-one errors) without Totem knowledge retrieval (#270)
  - **`totem compile --export`** — Cross-model lesson export via sentinel-based injection into AI assistant config files (#269)

  ### Improvements
  - Provider conformance suite with 15 tests and nightly smoke tests (#263)
  - CLA automation via `contributor-assistant/github-action` (#266)
  - Dependabot configured for security-only npm scanning and GitHub Actions version pinning (#272)
  - GitHub Actions updated: `actions/checkout` v4→v6, `actions/setup-node` v4→v6 (#273, #274)
  - Project docs and lessons synced via `totem wrap` (#275)

### Patch Changes

- Updated dependencies [e252d41]
  - @mmnto/totem@0.21.0

## 0.20.0

### Patch Changes

- fff1f27: Relicense to Apache 2.0.
- Updated dependencies [fff1f27]
  - @mmnto/totem@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.19.0

## 0.18.0

### Minor Changes

- feat: async orchestrator and ReDoS protection
  - Refactored shell orchestrator from `execSync` to async `spawn` with streaming stdout/stderr, 50MB safety cap, and proper timeout handling (#206)
  - Added compile-time ReDoS static analysis via `safe-regex2` — vulnerable regex patterns are rejected during `totem compile` with diagnostic reasons (#218)
  - Graceful per-doc error handling in `totem docs` — a single doc failure no longer aborts the entire batch

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [03372b4]
  - @mmnto/totem@0.17.0

## 0.16.1

### Patch Changes

- @mmnto/totem@0.16.1

## 0.16.0

### Minor Changes

- 76b4cf4: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

### Patch Changes

- Updated dependencies [76b4cf4]
  - @mmnto/totem@0.16.0

## 0.15.0

### Minor Changes

- Universal baseline lessons during `totem init` (#128), orphaned temp file cleanup on CLI startup (#108), and automated doc sync via `totem docs` command (#190) integrated into `totem wrap` as Step 4/4.

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.15.0

## 0.14.0

### Minor Changes

- 171a810: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

### Patch Changes

- Updated dependencies [171a810]
  - @mmnto/totem@0.14.0

## 0.13.0

### Patch Changes

- @mmnto/totem@0.13.0

## 0.12.0

### Patch Changes

- @mmnto/totem@0.12.0

## 0.11.0

### Minor Changes

- Await sync in `add_lesson` with 60s timeout, output cap, and process tree kill
- `search_knowledge` appends `<totem_system_warning>` when payload exceeds `contextWarningThreshold`

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [e97f5cd]
  - @mmnto/totem@0.10.0

## 0.9.2

### Patch Changes

- 373f872: fix: sync reliability and unified XML escaping
  - Persistent sync state tracking via .totem/cache/sync-state.json — no more missed changes (#155)
  - Deleted files are now purged from LanceDB during incremental sync (#156)
  - Unified wrapXml utility in @mmnto/core with consistent backslash escaping (#158)

- Updated dependencies [373f872]
  - @mmnto/totem@0.9.2

## 0.9.1

### Patch Changes

- fb8a72a: fix: harden host integration — XML safety, hook format, config validation, script extraction
  - XML-delimit MCP tool responses to mitigate indirect prompt injection (#149)
  - Fix Claude hook format: use {type, command} objects instead of bare strings (#153)
  - Replace manual type guards with Zod schema validation for settings.local.json (#148)
  - Extract inline shell hooks into dedicated Node.js scripts (.totem/hooks/) (#147)
  - @mmnto/totem@0.9.1

## 0.9.0

### Patch Changes

- cd7fe05: feat: seamless host integration — Gemini CLI & Claude Code hooks
  - hookInstaller infrastructure in `totem init` with idempotent scaffoldFile/scaffoldClaudeHooks utilities
  - Gemini CLI: SessionStart briefing hook, BeforeTool shield gate, Totem Architect skill
  - Claude Code: PreToolUse hook for shield-gating git push/commit
  - Cloud bot prompt refinement in AI_PROMPT_BLOCK for GCA integration
  - Enhanced `search_knowledge` tool description
  - @mmnto/totem@0.9.0

## 0.8.0

### Minor Changes

- 9ec7ffd: ### CLI UX Polish
  - **Branded CLI output** — All commands now display colored, tagged output via `picocolors` (cyan brand, green success, yellow warnings, red errors, dim metadata)
  - **Ora spinners** — `totem sync` shows a TTY-aware spinner that gracefully falls back to static lines in CI/piped environments
  - **ASCII banner** — `totem init` displays a branded Totem banner on startup
  - **Colored Shield verdict** — `totem shield` now shows PASS in green and FAIL in red

  ### Custom Prompt Overrides
  - **`.totem/prompts/<command>.md`** — Override the built-in system prompt for any orchestrator command (spec, shield, triage, briefing, handoff, learn) by placing a markdown file in your project
  - **Path traversal protection** — Command names are validated against a strict regex pattern

  ### Multi-Argument Commands
  - **`totem spec <inputs...>`** — Pass multiple issue numbers, URLs, or topics in a single invocation (max 5, deduplicated)
  - **`totem learn <pr-numbers...>`** — Extract lessons from multiple PRs in one command with a single confirmation gate

### Patch Changes

- Updated dependencies [9ec7ffd]
  - @mmnto/totem@0.8.0

## 0.7.0

### Minor Changes

- Unify gh-utils and PrAdapter, comprehensive test audit, bug fixes
  - Extracted shared `gh-utils` with `ghFetchAndParse` and `handleGhError`
  - Added `PrAdapter` abstraction for PR data fetching
  - Added unit tests for all adapters, orchestrator, and CLI commands
  - Fixed maxBuffer overflow on paginated GitHub API responses
  - Added GitHub API rate limit detection
  - Simplified ZodError messages for better UX

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.7.0

## 0.6.0

### Patch Changes

- @mmnto/totem@0.6.0

## 0.5.0

### Patch Changes

- @mmnto/totem@0.5.0

## 0.4.0

### Patch Changes

- @mmnto/totem@0.4.0

## 0.3.0

### Patch Changes

- @mmnto/totem@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.2.1

## 0.2.0

### Minor Changes

- 87a465a: Initial release — Phases 1-3 complete.
  - Core: LanceDB vector store, 5 syntactic chunkers (TS AST, markdown, session log, schema, test), OpenAI + Ollama embedding providers, full ingest pipeline with incremental sync
  - CLI: `totem init`, `totem sync`, `totem search`, `totem stats`
  - MCP: `search_knowledge` and `add_lesson` tools over stdio

### Patch Changes

- Updated dependencies [87a465a]
  - @mmnto/totem@0.2.0

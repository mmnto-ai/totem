# @mmnto/totem

## 1.14.5

### Patch Changes

- bd63810: Replace `execFileSync` with `cross-spawn.sync` in `safeExec` to close the Windows shell-injection vector (#1329)

  `safeExec` previously set `shell: IS_WIN` on its `execFileSync` call so that Windows `.cmd` and `.bat` shims (`git.cmd`, `npx.cmd`, etc.) could resolve without ENOENT errors. The side effect was that `cmd.exe` interpreted shell metacharacters (`&`, `|`, `>`, `"`, and so on) in argument values, creating both a correctness bug (see mmnto/totem#1233 for the stray `{}` file that appeared when `cmd.exe` parsed the arrow-function `=>` as `=` plus `>`) and a shell-injection surface for any caller that forwarded untrusted input through `safeExec`. 57 call sites across 16 files were at risk.

  The fix swaps the underlying primitive from Node's native `child_process.execFileSync` to `cross-spawn.sync`. `cross-spawn` handles Windows `.cmd` and `.bat` shim resolution internally without ever enabling `shell: true` at the Node layer, so shim resolution still works while shell metacharacters in argument values now pass through verbatim on all platforms. The public `safeExec(command, args, options): string` signature is unchanged, the throw-on-non-zero-exit contract is preserved, the `.cause` chain is preserved, and the existing `maxBuffer`, `timeout`, `trim`, and `stdin input` options behave identically.

  One additive extension to the error shape: the thrown Error on any failure path now exposes optional `.status`, `.signal`, `.stdout`, and `.stderr` fields matching the richer `SpawnSyncReturns` shape that `cross-spawn` provides. The `.stdout` and `.stderr` fields preserve raw subprocess output (trailing whitespace included) so callers see the unmodified bytes. Message formatting uses trimmed copies internally. Callers that only read `.message` and `.cause` (the pre-#1329 contract) continue to work unchanged. Callers that want to distinguish exit codes no longer have to parse the message body. A new test `exposes .status on the thrown error for non-zero exit codes` locks this in, and the `SafeExecErrorFields` interface is exported from `@mmnto/totem` so downstream packages can type-narrow without falling back to `any`.

  Test invariants locked in (3 new, all invariants from the #1329 design doc):
  1. Shell metacharacters in argument values pass through verbatim on all platforms (headline regression test, uses `hello&world>bar` as the canonical dangerous argument).
  2. Pipes and double quotes in argument values pass through verbatim (second metacharacter set covering `|` and `"`).
  3. Non-zero exit codes are exposed on the thrown Error via `.status`.

  Existing invariants (all 7 from the design doc) continue to pass after the refactor: throw-on-non-zero-exit, `.cause` chain, throw-on-command-not-found, timeout kill plus throw, trim default and override, and Windows `.cmd` shim resolution (indirectly verified via the existing `node` command resolution tests, which work via the same cross-spawn path).

## 1.14.4

### Patch Changes

- 55a7e19: Add parser-based semantic validation to `validateAstGrepPattern` (#1339)

  The pre-#1339 validator used a heuristic brace/paren depth tracker that caught obvious multi-root patterns (`;` or `\n` at depth 0) but missed single-line patterns that ast-grep still rejects as "Multiple AST nodes are detected" at runtime. The canonical failure from the 1.14.1 postmerge compile was `.option("--no-$FLAG", $$$REST)` — a floating member call with no receiver. The pattern has balanced parens, no statement separators, one visible "expression", and sails through the heuristic. ast-grep's actual rule compiler rejects it because `.option(...)` isn't a valid AST root node without a receiver. Result: the broken rule landed in `compiled-rules.json`, and every PR rebased on main that touched any `.ts` file crashed `totem lint` until someone manually deleted the rule.

  The fix keeps the existing heuristic as a fast-path (good error messages for the common cases) and adds a second layer that invokes ast-grep's actual rule compiler via `parse(Lang.Tsx, '').root().findAll(pattern)`. If ast-grep cannot compile the pattern into a single-rooted rule, the error surfaces at compile time instead of at runtime. The Tsx language is the most permissive parser (superset of TypeScript plus JSX), so any valid JS/TS/JSX/TSX pattern should pass. Empty source keeps the call cheap — ast-grep compiles the pattern into a rule object before iterating any AST, so rule-compile errors surface even against nothing to match.

  Also catches the latent `catch($E) { $$$ }` bug: bare catch clauses look valid to the heuristic but ast-grep rejects them because they can only exist as children of a try statement. The pre-existing test that asserted this pattern was valid was aspirational — no production rule ever used it (the compile gate nudged real rules into try-wrapped forms like `try { $$$BODY } catch ($ERR) {}`), so the bug never surfaced in shipped rules, but it would have on the first rule that tried.

  Lite-build safety: `validateAstGrepPattern` is only called from compile flows (`buildCompiledRule` / `buildManualRule`), which require an orchestrator and therefore never run in the Lite binary. The esbuild alias swaps `@ast-grep/napi` for the WASM shim in Lite builds, but since this function is dead code there, the shim's `ensureInit()` requirement is never triggered. The parser call is additionally wrapped in try/catch so any surprise error degrades conservatively to `valid: false` rather than crashing.

  Audit: all 203 production ast-grep rules in `.totem/compiled-rules.json` parse cleanly through the new check. No rule regressions.

## 1.14.3

### Patch Changes

- 0b3e274: Filter `status: 'archived'` rules out of `loadCompiledRules` (#1336)

  `loadCompiledRules` previously returned every rule in `compiled-rules.json` regardless of lifecycle state. The schema had the `status: 'active' | 'archived'` field since the `totem doctor --pr` GC phase shipped, the doc comment on the schema literally said "active rules are enforced, archived rules are skipped", and the `totem doctor --pr` self-healing loop mutated stale rules to `status: 'archived'` with an `archivedReason` — but nothing in the lint execution path actually filtered them out. The self-healing loop was a placebo: archiving a rule via `totem doctor` left it firing in the linter. The only way to truly silence a rule was to delete it from the JSON.

  `loadCompiledRules` now applies `parsed.rules.filter((r) => r.status !== 'archived')` before returning. Legacy rules without a `status` field stay enabled (using `!== 'archived'` rather than `=== 'active'` so undefined is treated as active). `loadCompiledRulesFile` remains unfiltered so admin consumers (`totem doctor`, `totem compile`, `totem import`) can still read archived entries for lifecycle management and telemetry persistence — archiving is not deletion; the rule stays in the manifest.

  Effect: `totem doctor --pr` archive path now works as documented. Archived rules no longer produce violations during `totem lint`, `totem review`, or `runRuleTests`. No config migration required.

## 1.14.2

## 1.14.1

### Patch Changes

- b76128e: 1.14.1 — Hotfix sweep (#1311)

  Bundled fixes for four post-1.14.0 regressions surfaced during the first day of 1.14.0 in production:
  - **#1304** — `totem review` and `totem lint` were running rules against on-disk content instead of staged content when files had unstaged modifications. The rule engine now loads staged blob content via `git show :path` when a path is in the index, and reads from the filesystem only when the path is unstaged. Path containment is also hardened to reject symlinks that escape the repo root.
  - **#1305** — `lance-search` predicates were failing on any field name containing a SQL keyword or dash (`source-repo`, `file-type`) because the generated `WHERE` clause lacked backtick quoting. Field identifiers are now backtick-wrapped consistently.
  - **#1306** — AST engine test coverage audit found an uncovered branch in `ast-query` that silently returned an empty result set for malformed tree-sitter query strings. It now throws a descriptive error so `totem compile` can surface the broken rule instead of silently dropping it.
  - **#1309** — `totem doctor` and `totem lint` were still printing the legacy `totem review --fix` hint after that flag was removed in 1.12. Updated to the current `totem review --apply` form.

- b76128e: Reject nonsense Pipeline 5 observation rules (#1324)

  Pipeline 5 (auto-capture from Shield findings) was faithfully converting every source line Shield flagged into an observation rule, including lines that were pure syntactic noise (`}`, `*/`, bare braces) or comment-only. The result was a steady drip of garbage rules that users had to clean up via `git checkout -- .totem/compiled-rules.json` after every `totem review`.

  `generateObservationRule()` now rejects source lines with fewer than 3 alphanumeric characters and lines that are entirely comments (JSDoc, block-comment continuation, line comments, bare hash). The check is deliberately minimal — the goal is to drop obvious noise, not to second-guess Shield's judgment on real code.

  Closes #1279. Three consecutive reproductions (`*/`, `}`, and PR #1292's own cascade-fix commits) blocked on this gate in testing.

- b76128e: Support tilde-fenced code blocks in lessons and compiler output (#1326)

  CommonMark allows `~~~` as an alternate code-fence delimiter. Totem's lesson parser, compiler-response parser, drift detector, lesson linter, and suspicious-lesson detector were all hard-coded to recognize only triple-backtick fences, so any lesson authored with tilde fences silently lost its code blocks during extraction and compilation.

  Seven files updated to match both fence styles. Every regex uses a capture group plus backreference for the opening delimiter, so opening and closing fences must match — mixing fence styles in a single block won't cross-match and produce garbage captures.

## 1.14.0

### Minor Changes

- 11ab03b: 1.14.0 — The Nervous System Foundation

  Cross-repo federated context (shipped as the headline feature) plus opt-in preview of persistent LLM context caching. Mesh and caching are two halves of the same nervous system — sharing context across space (cross-repo federation) and across time (cached tokens) — but they ship at different maturity levels in 1.14.0: mesh is the active default, caching is opt-in preview machinery whose default activation is tracked for 1.15.0 in mmnto/totem#1291.
  - **Cross-Repo Context Mesh (#1295):** New `linkedIndexes: []` option in `totem.config.ts` lets a repo federate semantic search against sibling Totem-managed repos. `SearchResult` now includes source context fields (`sourceRepo`, `absoluteFilePath`) so agents can Read/Edit results unambiguously regardless of which repo the hit came from. Federation merges results via cross-store Reciprocal Rank Fusion (RRF k=60) rather than raw score comparison, eliminating the score-scale bias that would otherwise pin one store's results below another's when their underlying search methods produce scores in incompatible ranges (hybrid RRF ~0.03 vs vector-only ~0.85). A healthy primary + one broken linked store returns partial results with a per-query runtime warning; an entire-federation outage returns `isError: true` instead of masking as "no results found." Per-store reconnect+retry recovers from stale handles during concurrent `totem sync` rebuilds. Targeted `boundary: "<name>"` queries route only to that linked store. Strategy Proposal 215.
  - **LLM Context Caching — Opt-In Preview (#1292):** Anthropic `cache_control` markers wired through the orchestrator middleware for compile + review paths. Sliding TTL configurable via `cacheTTL`, constrained to the two values Anthropic supports natively: `300` (5 minutes, default ephemeral) or `3600` (1 hour, extended cache). The TTL resets on every cache hit, so bulk recompile runs stay warm end-to-end as long as operations land inside the active window. **Defaults to off in 1.14.0** — opt-in via `enableContextCaching: true` in `totem.config.ts` to avoid surprising existing users mid-cycle with a token-usage profile shift. Default activation tracked for 1.15.0 in mmnto/totem#1291. Anthropic-only in this release; Gemini `CachedContent` support tracked for 1.16.0+. Strategy Proposal 217. The full machinery (orchestrator middleware, schema field, TTL-literal validation, per-call cache metric tracking) ships in 1.14.0 — only the default-on behavior is deferred.
  - **Federation diagnostic hardening:** Dimension-mismatch diagnostic now persists across queries (one-shot is wrong when the underlying state is actively blocking — a single warning followed by cryptic LanceDB errors was worse than a persistent actionable message). One-shot first-query flags are only consumed after the gated operation actually succeeds, so transient `getContext` failures don't permanently suppress startup warnings. Linked-store init warnings (empty stores, name collisions, dimension mismatches) survive reconnect cycles intact — they represent static config state that a runtime reconnect can't fix.
  - **Collision-safe state:** Linked store name collisions (two paths deriving to the same basename) are keyed under the bare derived name in `linkedStoreInitErrors` so the `performSearch` boundary lookup can find them — earlier revisions used a descriptive composite key that was unreachable by any user-facing query. Primary store failures are tracked in a dedicated `FailureLog.primary` slot rather than overloading `'primary'` as a map key, which would have collided with legal link names (`deriveLinkName` strips leading dots, so a linked repo at `.primary/` derives to `'primary'`).
  - **Smoke test (#1295 Phase 3):** Standalone CLI integration test (`packages/mcp/dist/smoke-test.js`) exercises a real `ServerContext` against the current `totem.config.ts`, runs a federated query across primary + all linked stores, and emits a pass/fail verdict with per-store hit counts and top-N formatted results. Used as the empirical proof for the PR #1295 body; repurposable for any future cross-repo validation.
  - **19 lessons extracted** from the 1.14.0 PR arc (#1292, #1295, #1296); 1 new compiled rule via local Sonnet (394 total, up from 393). 18 lessons skipped as architectural/conceptual — tracked as `nonCompilable` tuples for doctor triage. Most of the architectural 1.14.0 learnings (silent-drift anti-patterns, reserved-key collisions, session-vs-per-request state confusion, failure-modes-table-as-design-review-tool) are non-compilable by nature but live in `.totem/lessons/` as referenceable architectural patterns. (The initial compile pass produced 2 rules; the delimiter-cache-key rule was reframed as architectural after both bots caught a malformed ast-grep pattern that the LLM produced twice in a row — Tenet 4 says broken rules should not ship, so the lesson now lives as documentation only.)
  - **2722 tests** across core + cli + mcp (up from 2580 at the start of the 1.14.0 cycle).

## 1.13.0

### Minor Changes

- 0b08629: 1.13.0 — The Refinement Engine

  Telemetry-driven rule refinement, compilation routing through Claude Sonnet 4.6, and structural pattern upgrades. The compile pipeline now generates high-fidelity rules at scale (393 precise rules, 203 ast-grep / 190 regex), and the doctor diagnostic closes the loop on noisy ones.
  - **Sonnet routing (#1220):** Compile pipeline routes through `anthropic:claude-sonnet-4-6` instead of Gemini. Strategy #73 benchmark across 30 lessons in 4 difficulty tiers proved Sonnet wins on every metric — 90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg. The compiler system prompt was rewritten with explicit ast-grep preference, a syntax cheat sheet, and 6 compound pattern examples mined from benchmark failures.
  - **Bulk Sonnet recompile (#1224):** All 1156 lessons recompiled through Claude Sonnet — 438 → 393 rules, 102 regex→ast-grep upgrades, 143 noisy hallucinated rules purged. Quality > quantity is now enforced by the compile gate, not by manual curation.
  - **Backtick parser hardening (#1225):** Both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output) strip code-fence wrappers from generated patterns so rules can never ship with backtick artifacts.
  - **Context telemetry (#1132, #1227):** `RuleMetric` now tracks the per-context match distribution — `{ code, string, comment, regex, unknown }`. The match context comes from the rule runner's `astContext` field; historical hits are seeded into the `unknown` bucket so legacy metrics remain interpretable.
  - **`totem doctor` upgrade diagnostic (#1131):** New `checkUpgradeCandidates` flags regex rules whose telemetry shows >20% of matches landing in non-code contexts (strings, comments, regex literals). Excludes the `unknown` bucket from the ratio math and requires a 5-event minimum-confidence floor. The legacy `ast` (Tree-sitter) engine is filtered out because its telemetry lands in `unknown` and can't be reasoned about.
  - **`totem compile --upgrade <hash>`:** Re-compile a single targeted rule by hash (full or short prefix). Scoped cache eviction preserves the rule's original `createdAt` metadata; failure paths leave the old rule intact (fail-safe); the `compiled` and `skipped` outcomes are handled consistently. Returns an `UpgradeOutcome { hash, status }` discriminant so callers can distinguish actual replacements from noop / skipped / failed. Rejects `--cloud` (cloud worker still on Gemini, tracked as #1221) and `--force` (the scoped eviction makes both flags redundant and dangerous).
  - **`totem doctor --pr` self-healing upgrade phase:** Slots after the existing downgrade and GC phases. Calls `compileCommand` in-process (no shelling out), only counts `'replaced'` outcomes as actual upgrades, stages `compile-manifest.json` alongside `compiled-rules.json`, and reverts the manifest when nothing changes so the working tree stays clean.
  - **AST empty catch (#664):** 8 empty-catch rules upgraded from the legacy Tree-sitter `#eq?` engine to `ast-grep` structural matching. Correctly handles parameterless catch blocks (ES2019+) and multi-line empty bodies that the predicate-based approach missed.
  - **Pipeline hygiene (#1210, #1211, #1214):** Wind tunnel skips auto-scaffolded TODO fixtures so empty placeholders don't dilute the gate signal. Extract pipeline runs heading-level exact-match deduplication before embedding similarity to short-circuit duplicate ingestion at zero cost. Config-drift test replaced its line-count limit on instructional files with a token-aware character + directive count limit.
  - **Lesson protection rule (governance):** A near-miss almost deleted `.totem/lessons.md` (which sources 41+ functional ast-grep rules) under the assumption it was legacy cruft. Encoded as a Pipeline 1 lint rule with severity `error` that flags the destructive shell command at the point of intent across all script and documentation files. When an agent makes a mistake, the right answer is a deterministic constraint, not a sticky note.
  - **Drift detector — shell prefix filter (core fix):** `extractFileReferences` in `@mmnto/totem` now skips backtick-wrapped strings starting with a recognizable shell command prefix (`rm`, `git rm`, `cp`, `mv`, `cat`, `less`, `head`, `tail`, `tee`, `chmod`, `chown`, `touch`). This is a pre-existing latent bug that surfaced when the lesson protection rule above put `git rm <path>` in its Example Hit / Miss lines — the detector was misparsing the shell command as a literal path and reporting it as orphaned. New unit test in `drift-detector.test.ts` locks in the behavior across all supported shell prefixes.

## 1.12.0

### Minor Changes

- c4f9746: 1.12.0 — The Umpire & The Router
  - Standalone binary: lite-tier distribution works without Node.js, using @ast-grep/wasm for full AST rule coverage across linux-x64, darwin-arm64, win32-x64
  - Ollama auto-detection: `totem init` detects local Ollama and defaults to gemma4 for classification
  - ast-grep for ESLint properties: `no-restricted-properties` import uses precision AST matching
  - Lazy WASM init: AST engine only initializes when lint/test commands need it
  - GHA injection rule scope: narrowed to `run:` contexts, no false positives in `env:`/`with:` blocks
  - Windows CI stability: fixed flaky orchestrator timeout

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

## 1.10.2

### Patch Changes

- 7b51599: Phase 2: Import Engine foundations
  - Lesson retirement ledger (.totem/retired-lessons.json) prevents re-extraction of intentionally removed rules
  - Compiler guard rejects self-suppressing patterns (totem-ignore/totem-context/shield-context)
  - ESLint adapter: no-restricted-properties (dot, optional chaining, bracket notation) and no-restricted-syntax (ForInStatement, WithStatement, DebuggerStatement) handlers
  - Model defaults updated: claude-sonnet-4-6 (Anthropic), gpt-5.4-mini (OpenAI)
  - Supported models reference refreshed (2026-04-04)

## 1.10.1

## 1.10.0

## 1.9.0

### Minor Changes

- 1650e51: 1.9.0 — Pipeline Engine milestone release

  Five pipelines for rule creation: P1 manual scaffolding, P2 LLM-generated, P3 example-based compilation, P4 ESLint/Semgrep import, P5 observation auto-capture. Docs, wiki, and playground updated to match.

## 1.8.5

### Patch Changes

- 9a6a1a0: Add Pipeline 5 observation-based auto-capture from shield findings

## 1.8.4

### Patch Changes

- 1bb150d: Add Pipeline 3 example-based compilation prompt for Bad/Good code snippet lessons

## 1.8.3

## 1.8.2

### Patch Changes

- 11f4512: Add pre-compiled baseline rules for Python (4), Rust (3), and Go (2) ecosystems

## 1.8.1

### Patch Changes

- f088d68: feat: prior art concierge for `totem spec` (#1015)

  Injects shared helper signatures into the spec prompt so agents discover existing utilities (safeExec, readJsonSafe, git helpers, maskSecrets) instead of reimplementing them.

- f088d68: feat: intelligent scope inference for `totem extract` (#1014)

  Analyzes PR changed files and pre-injects a scope suggestion into the extraction prompt so the LLM produces better file glob scopes on extracted lessons.

## 1.8.0

### Minor Changes

- 4d87c56: feat: auto-scaffold test fixtures for Pipeline 1 rules (#854) and shield auto-learn (#779)
  - Pipeline 1 error rules now auto-generate test fixture skeletons during compile, preserving error severity instead of downgrading to warning (ADR-065)
  - New `totem rule scaffold <id>` command for manual fixture generation with `--out` option
  - Fixtures seeded from Example Hit/Miss when available, otherwise TODO placeholders
  - New `shieldAutoLearn` config option: when true, shield FAIL verdicts auto-extract lessons without `--learn` flag

## 1.7.2

### Patch Changes

- 8fe2329: feat: rule garbage collection and compile progress indicator (#1040, #894)
  - `totem doctor --pr` now archives stale compiled rules (zero triggers after configurable minAgeDays). Opt-in via `garbageCollection` config block. Security-category rules are exempt.
  - `totem compile` now shows elapsed time and ETA with throughput-based estimation. Rate-limited LLM calls (429) are automatically retried with jittered exponential backoff.

## 1.7.1

## 1.7.0

### Minor Changes

- Version bump to align with CLI package release

## 1.6.3

### Patch Changes

- Version bump to align with CLI package release

## 1.6.2

### Patch Changes

- Version bump to align with CLI package release

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

## 1.5.11

### Patch Changes

- 7cd543a: feat: exemption engine, auto-ticket deferred, interactive triage
  - Exemption Engine (#917): dual-storage FP tracking (local + shared), 3-strike auto-promotion, --suppress flag, bot review integration
  - Auto-ticket (#931): createDeferredIssue service with idempotency, milestone inference, thread reply
  - Interactive Triage (#958): Clack prompts for PR triage with fix/defer/dismiss actions
  - Ledger: 'exemption' event type for audit trail
  - Bot review parser: extractPushbackFindings, shared PUSHBACK_PATTERNS constant

## 1.5.10

### Patch Changes

- 990c3bf: Incremental shield, totem status/check, docs staleness fix.
  - feat: incremental shield validation — delta-only re-check for small fixes (#1010)
  - feat: totem status + totem check commands (#951)
  - fix: totem docs staleness — aggressive rewrite of stale roadmap sections (#1024)
  - fix: mermaid lexer error in architecture diagram
  - chore: MCP add_lesson rate limit bumped to 25 per session
  - chore: 364 compiled rules, 966 lessons, 2,000 tests

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

## 1.5.5

### Patch Changes

- 19de6b1: feat: categorized triage UX for bot review comments (#956)
  feat: doctor --pr — autonomous rule downgrading (#961)
  feat: auto-format staged files in pre-commit hook

## 1.5.4

### Patch Changes

- 7f5d4e7: feat: user-defined secrets — custom DLP patterns (#921)
  feat: Local Trap Ledger — capture exceptions to NDJSON (#960)
  feat: /review-learn — extract lessons from bot PR reviews (#930)
  fix: SARIF output emits error-severity findings only
  fix: SARIF warning summary as single note annotation

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

## 1.5.0

### Minor Changes

- ### 1.5.0 — Open Ecosystem

  **New Commands**
  - `totem list` — discover all Totem workspaces via global registry (`~/.totem/registry.json`)
  - `totem doctor` — run 6 diagnostic checks (config, rules, hooks, embedding, index, secret leaks)

  **Features**
  - Language-agnostic hook installation — hooks resolve `totem` binary at runtime via `command -v`, fall back to package manager `dlx` commands
  - Hook manager helper scripts — `.totem/hooks/*.sh` generated for Husky/Lefthook/simple-git-hooks integration
  - `userFacing` flag on DocTarget for scoped post-processing
  - Smart shield review hints — auto-detects DLP artifacts, test files, new files in diff
  - `// shield-context:` inline annotations for per-file shield guidance
  - `.totem/prompts/shield.md` override with verdict format enforcement

  **SARIF Improvements**
  - Tool name corrected: `totem-shield` → `totem-lint`
  - `helpUri` per rule links to wiki
  - Rich annotation messages with lesson context and rule ID

  **Research**
  - Binary distribution spike: full standalone blocked by LanceDB (144MB native), Lite-tier binary feasible

  **CI/DX**
  - Compile Manifest Attestation skips docs-only PRs via path filter
  - Wiki reorganization: internal docs converted to Totem lessons
  - Shield documentation: new "Working with Shield" wiki page

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

## 1.4.2

### Patch Changes

- f1509d3: Post-1.4.0 quality sweep (Proposal 189): security fixes, broken functionality, 154 new tests, quality hardening, DRY cleanup, and compile manifest CI attestation

## 1.4.1

### Patch Changes

- ec5b807: Security sweep: fix sanitizer regex statefulness (#871), secret pattern ordering (#872), extract parser injection vector (#873), SQL escaping (#874), and add compile manifest CI attestation (#875)

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

## 1.3.19

### Patch Changes

- feat: markdown-magic deterministic doc injection
  - Integrated markdown-magic with 4 transforms (RULE_COUNT, HOOK_LIST, CHMOD_HOOKS, COMMAND_TABLE)
  - Wired docs:inject into totem wrap pipeline (step 5/6, after LLM docs, before compile)
  - 9 unit tests for transforms, runs in 0.02s
  - Eliminates stale hardcoded values in docs across releases

## 1.3.18

### Patch Changes

- feat: invisible sync hooks (ADR-066)
  - Post-merge hook only syncs when `.totem/lessons/` files change (git diff-tree conditional)
  - New post-checkout hook syncs on branch switch when `.totem/` differs
  - `totem sync --quiet` flag for silent background hook execution
  - Deterministic end markers for safe eject scrubbing
  - DRY scrubHook helper with try/catch and exact marker matching
  - 230 compiled rules (19 new), 697 lessons

## 1.3.17

### Patch Changes

- God Object cleanup: extract.ts (804→566), shield.ts (587→475), audit.ts (560→510), lance-store.ts (523→285). Suspicious lesson detection + semantic dedup moved to core. Nit extraction from CodeRabbit review bodies. Compiler quality gate for untested error rules. Wind tunnel CI gate.

## 1.3.16

### Patch Changes

- Universal Baseline grows from 15 → 23 rules (8 Gemini-validated ast-grep patterns). Wind tunnel: 9 test fixtures + ast-grep test runner fix. Adversarial corpus (16 clean-room fixtures). TypeScript detection for monorepo per-package tsconfig.json.

## 1.3.15

### Patch Changes

- Rule audit Phase 4: kill bad patterns, scope noisy rules, extract lessons from PR 816. Full audit progression: 2,713 → 555 violations (0 on enforcement path).

## 1.3.14

### Patch Changes

- Rule audit: kill 70 garbage rules, dedup 18 overlaps (327 → 239). Docs prompt fix: strip issue refs from user-facing output. README cleanup.

## 1.3.13

### Patch Changes

- Spec template tests (#805), spec/compile prompt extraction (#806, #799), compiler utility tests, prompt versioning, post-compact gate strengthening

## 1.3.12

### Patch Changes

- Agent workflow doc, spec straitjacket upgrade (militant red flags + Graphviz), lean GEMINI.md, PostCompact agent discipline reminder

## 1.3.11

### Patch Changes

- 0b47c94: Security hardening: regex escape, shell:true removal, SQL backtick escape. CodeRabbit integration with path instructions. onWarn logging for AST catch blocks. Unsafe non-null assertions replaced.

## 1.3.10

### Patch Changes

- ceb8663: Context engineering (ADR-063): lean CLAUDE.md router pattern, PostCompact capability manifest, phase-gate enforcement (spec warning before commit). Fixed doc regen hallucination loop.

## 1.3.9

### Patch Changes

- 48cd644: Named index partitions for context isolation. Backfilled body text for 125 Pipeline 1 lessons. Consolidated near-duplicate rules (146 → 144).

## 1.3.8

### Patch Changes

- 16e6071: Context isolation boundary parameter for search_knowledge MCP tool. Consolidated near-duplicate rules (146 → 144).

## 1.3.7

### Patch Changes

- 6a2eb4c: Lesson linter with pre-compilation gate, spec straitjacket format (TDD forcing + inline invariants), cross-platform CI matrix.

## 1.3.6

### Patch Changes

- 09153f8: Pipeline 1 backfill: 127 curated rules now compile deterministically (zero LLM). Added .totem/lessons/ to .prettierignore. Workflow automation hooks and skills for Claude Code.

## 1.3.5

### Patch Changes

- 5810bcc: ### Knowledge Quality & Security
  - All 59 universal baseline lessons now include actionable Fix guidance — agents know HOW to resolve violations, not just WHAT is wrong (#642)
  - Path traversal containment check using path.relative prevents reads outside the project directory (#738)
  - Traversal skip now logs a warning via onWarn callback for visibility (#739)

## 1.3.4

### Patch Changes

- 98d56dc: ### Security & Compiler Hardening
  - `totem link` now requires explicit consent ("I understand") before creating cross-trust-boundary bridges. Bypass with `--yes` for CI/CD.
  - Shell orchestrator process termination uses process groups on Unix (prevents zombie processes)
  - SECURITY.md expanded with threat model, audit results, and Totem Mesh risks
  - Gate 1 (Proposal 184): Compiled rules now default to `severity: 'warning'` when LLM omits severity, preventing the #1 compiler regression
  - Added `severity` field to `CompilerOutputSchema`

## 1.3.3

## 1.3.2

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

## 1.3.0

### Patch Changes

- a02f7f8: Release 1.3.0 — MCP verify_execution, spec inline invariants, baseline Fix guidance.

  ### Highlights
  - **MCP `verify_execution` tool**: AI agents can now mathematically verify their work before declaring a task done. Runs `totem lint` as a child process and returns pass/fail with violation details. Supports `staged_only` flag. Warns about unstaged changes.
  - **Spec inline invariant injection**: `totem spec` now outputs granular implementation tasks with Totem lessons injected directly into the steps where they apply. Closes the gap between "planning" and "doing."
  - **Baseline Fix suggestions**: 24 of 59 universal baseline lessons updated with explicit "Fix:" guidance. Every lesson now tells developers what TO do, not just what to avoid.

## 1.2.0

### Minor Changes

- baf6e15: Release 1.2.0 — ast-grep engine, compound rules, and shield CI hardening.

  ### Highlights
  - **ast-grep pattern engine**: Third rule engine alongside regex and Tree-sitter. Patterns look like source code (`process.env.$PROP`, `console.log($ARG)`) — dramatically easier for LLMs to generate accurately.
  - **ast-grep compound rules**: Full support for `has`/`inside`/`follows`/`not`/`all`/`any` operators via NapiConfig rule objects. Enables structural rules like "useEffect without cleanup."
  - **Shield CI hardening**: `shieldIgnorePatterns` now filters the diff before linting, preventing `.strategy` submodule pointer changes from triggering false CI failures.
  - **Dynamic import rules narrowed**: Code scanning alerts for dynamic imports in command files eliminated — rules now only apply to core/adapter code.
  - **Case-insensitive hash matching**: `totem explain` and `totem test --filter` now match regardless of case.
  - **README hardened**: Staff Engineer red team feedback addressed — deterministic enforcement, air-gapped operation, and git-committed artifacts all clarified.
  - **Docs injection scoped**: Manual content injection now targets README only, not all docs.

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

## 0.44.0

### Minor Changes

- ab254bf: feat: migrate 54 throw sites to TotemError hierarchy

  Every error now includes a `recoveryHint` telling the user exactly how to fix it. New error classes: `TotemOrchestratorError`, `TotemGitError`. New error code: `GIT_FAILED`. Includes rule fix exempting error class imports from the static import lint rule.

## 0.43.0

## 0.42.0

### Minor Changes

- 557d046: feat: DLP secret masking — strip secrets before embedding (#534)

  Automatically masks API keys, tokens, passwords, and credentials with [REDACTED] before entering LanceDB. Preserves key names in assignments. Handles quoted and unquoted patterns.

  fix: compiler glob patterns — prompt constraints + brace expansion (#602)

  Compiler prompt now forbids unsupported glob syntax. Post-compile sanitizer expands brace patterns. Fixed 12 existing rules.

  fix: init embedding detection — Gemini first (#551)

  Reorders provider detection to prefer Gemini (task-type aware) over OpenAI when both keys present.

  fix: review blitz 2 — dynamic imports, onWarn, rule demotions (#575, #594, #595)

  compile.ts dynamic imports, loadCompiledRules onWarn callback, err.message rule demoted to warning.

  docs: Scope & Limitations section, Solo Dev Litmus Test styleguide rule

## 0.41.0

### Minor Changes

- 028786b: perf: cache non-compilable lessons to skip recompilation (#590)

  `totem compile` now caches lesson hashes that the LLM determined cannot be compiled. Subsequent runs skip them instantly. `totem wrap` goes from ~15 min to ~30 seconds.

  fix: remove duplicate compiled rule causing false positives (#589)

  Root cause was duplicate rules from compile, not a glob matching bug. Removed the broad duplicate.

  feat: auto-ingest cursor rules during totem init (#596)

  `totem init` scans for .cursorrules, .mdc, and .windsurfrules. If found, prompts user to compile them into deterministic invariants.

  fix: strip known-not-shipped issue refs from docs generation (#598)

  Ends the #515 hallucination that recurred in 5 consecutive releases. Pre-processing strips from git log, post-processing strips from LLM output.

## 0.40.0

### Minor Changes

- 99f8995: feat: .mdc / .cursorrules ingestion adapter (#555)

  New `totem compile --from-cursor` flag. Scans .cursor/rules/\*.mdc, .cursorrules, and .windsurfrules files. Parses frontmatter and plain text rules. Compiles them into deterministic Totem rules via the existing LLM pipeline.

  docs: README Holy Grail positioning (ADR-049)

  "A zero-config CLI that compiles your .cursorrules into deterministic CI guardrails. Stop repeating yourself to your AI." MCP as step 2, Solo Dev Superpower section, command table with speed metrics.

## 0.39.0

### Minor Changes

- dda8715: feat: shield severity levels — error vs warning (#498)

  Rules now support `severity: 'error' | 'warning'`. Errors block CI, warnings inform but pass. SARIF output maps severity to the `level` field. JSON output includes error/warning counts.

  chore: rule invariant audit — 137 rules categorized (#556)

  27 security (error), 56 architecture (error), 47 style (warning), 7 performance (warning). 39% reduction in hard blocks while maintaining all guidance.

  fix: auto-healing DB — dimension mismatch + version recovery (#500, #548)

  LanceStore.connect() auto-heals on embedder dimension mismatch and LanceDB version/corruption errors. Nukes .lancedb/ and reconnects empty for a clean rebuild.

## 0.38.0

### Minor Changes

- 89fcb02: feat: Trap Ledger Phase 1 — SARIF extension + enhanced totem stats

  Every `totem lint` violation now generates SARIF properties with eventId, ruleCategory, timestamp, and lessonHash. Rules support a `category` field (security/architecture/style/performance). `totem stats` shows "Total violations prevented" with category breakdown and top 10 prevented violations.

  fix: code review blitz — 7 findings from Claude+Gemini synthesis

  Critical: MCP loadEnv quote stripping, add_lesson race condition (promise memoization), SARIF format flag works with totem lint. High: extracted shared runCompiledRules (-75 lines), Gemini default model fixed, health check --rebuild → --full, lesson validation before disk write.

  fix: stale prompts — docs glossary, init model, reflex block v3

  Command glossary in docs system prompt prevents LLM confusing lint/shield. Gemini embedder model corrected in init. AI_PROMPT_BLOCK distinguishes lint (pre-push) from shield (pre-PR).

  chore: 137 compiled rules (39 new), 17 extracted lessons, docs sync

## 0.37.0

### Minor Changes

- 382c77a: feat: `totem lint` — new command for fast compiled rule checks (zero LLM)

  Split from `totem shield`. `totem lint` runs compiled rules against your diff in ~2 seconds with no API keys needed. `totem shield` is now exclusively the AI-powered code review. `--deterministic` flag is deprecated with a warning.

  feat: semantic rule observability (Phase 1)

  Rules now track `createdAt`, `triggerCount`, `suppressCount`, and `lastTriggeredAt` metadata. `totem stats` displays rule metrics. Foundation for automated rule decay analysis.

  fix: shield rule scoping — dynamic import and match/exec rules narrowed

  Dynamic import rule scoped to command files only (not adapters/orchestrators). match/exec rule scoped to security-sensitive code only. `.cjs` rule excludes CI workflow YAML.

## 0.36.0

### Minor Changes

- 74e521e: feat: graceful degradation for orchestrator and embedder providers

  Orchestrators (Gemini, Anthropic) now fall back to their CLI equivalents when the SDK or API key is missing. Embedders fall back to Ollama when the configured provider is unavailable. LazyEmbedder uses promise memoization to prevent race conditions with concurrent embed() calls.

  feat: configurable issue sources — support multiple repos in triage/extract/spec

  Add `repositories` field to `totem.config.ts`. When set, triage, audit, and spec commands aggregate issues from all listed repos. Supports `owner/repo#123` syntax for disambiguation.

  chore: switch default embedder to Gemini (gemini-embedding-2-preview)

  Task-type aware 768d embeddings replace OpenAI text-embedding-3-small (1536d). Requires `totem sync --full` after upgrade.

## 0.35.1

### Patch Changes

- 9cd061e: Bug blitz: four fixes from triage priorities.
  - **#396:** Anthropic orchestrator uses model-aware max_tokens (Haiku 4K, Sonnet 8K, Opus 16K)
  - **#397:** matchesGlob now supports single-star directory patterns (e.g., `src/*.ts`)
  - **#398:** extractChangedFiles handles quoted paths with spaces
  - **#399:** AST gate reads staged content (`git show :path`) before falling back to disk

## 0.35.0

### Minor Changes

- f6074c4: Upgrade @lancedb/lancedb from 0.13.0 to 0.26.2.
  - Fixes FTS (Full-Text Search) WAND panic (#491) — "pivot posting should have at least one document"
  - Lance engine upgraded from v0.19 to v2.0.0 — improved search performance, FTS stability, and cache efficiency
  - Users should run `totem sync --full` after upgrading to rebuild the index with the new engine format

## 0.34.0

## 0.33.1

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

## 0.32.0

### Minor Changes

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

## 0.31.0

### Minor Changes

- feat: hybrid search (FTS + vector with RRF reranking), Gemini embedding provider, retrieval eval script
- feat: lessons directory migration — dual-read/single-write (per-file lessons replace monolithic lessons file)

## 0.30.0

### Patch Changes

- d0be9c6: Add compile --export as Step 5 of totem wrap, exclude export targets from deterministic shield, throw NoLessonsError in compile command

## 0.29.0

### Patch Changes

- e311aff: Lesson injection into all orchestrator commands, totem audit, and Junie docs.
  - **`totem audit`** — strategic backlog audit with human approval gate, interactive multi-select, shell injection prevention via `--body-file`, resilient batch execution (#362)
  - **Lesson injection** — vector DB lessons now injected into shield (full bodies), triage (condensed), and briefing (condensed) via shared `partitionLessons()` + `formatLessonSection()` helpers (#370)
  - **Junie docs** — MCP config example and export target docs in README (#371)
  - **Lesson ContentType** — `add_lesson` MCP tool now uses `lesson` content type for better vector DB filtering (#377)
  - **Versioned reflex upgrade** — `REFLEX_VERSION=2` with `detectReflexStatus()` and `upgradeReflexes()` for existing consumers (#375)
  - **Spec lesson injection** — lessons injected as hard constraints into `totem spec` output (#366)

## 0.28.0

### Minor Changes

- d221d54: Extraction Hardening: semantic dedup for `totem extract`, dangling-tail heading cleanup, submodule-aware file resolver, and CLI `--help` fix.

## 0.27.0

### Minor Changes

- 20c912d: feat: saga validator for `totem docs` — deterministic post-update validation catches LLM hallucinations (checkbox mutations, sentinel corruption, frontmatter deletion, excessive content loss) before writing to disk (#356)

  fix: scope deterministic shield rules with fileGlobs — 21 of 24 compiled rules now have package-level glob scoping, preventing MCP-specific rules from firing against the entire codebase. Also fixes `matchesGlob` to support directory-prefixed patterns like `packages/cli/**/*.ts` (#357)

## 0.26.1

## 0.26.0

## 0.25.0

### Minor Changes

- 0455d24: Adversarial ingestion scrubbing, eval harness, Bun support, and model audit
  - **Adversarial ingestion scrubbing:** `sanitizeForIngestion()` strips BiDi overrides (Trojan Source defense) from all content types and invisible Unicode from prose chunks. Suspicious patterns flagged via `onWarn` but never stripped. Detection regexes consolidated into core for DRY reuse. XML tag regex hardened against whitespace bypass.
  - **Adversarial evaluation harness:** Integration tests with planted architectural violations for model drift detection. Deterministic tests run without API keys; LLM tests gated behind `CI_INTEGRATION=true` for nightly runs against Gemini, Anthropic, and OpenAI.
  - **Bun support:** `detectTotemPrefix()` checks for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2). Priority: pnpm > yarn > bun > npx.
  - **Model audit:** Updated default orchestrator model IDs — Anthropic to `claude-sonnet-4-6`, OpenAI to `gpt-5.4`/`gpt-5-mini`.
  - **Supported models doc:** New `docs/supported-models.md` with provider model listing APIs and discovery scripts.

## 0.24.0

### Patch Changes

- 3b8e53b: feat: git hook enforcement — block main commits + deterministic shield gate

  `totem init` now installs two enforcement hooks alongside the existing post-merge hook:
  - **pre-commit**: blocks direct commits to `main`/`master` (override with `git commit --no-verify`)
  - **pre-push**: runs `totem shield --deterministic` before push, bails instantly if no compiled rules exist (zero Node startup penalty for Lite tiers)

  Both hooks are idempotent, chain-friendly (append to existing hooks without clobbering), and cross-platform. Non-shell hooks (Node/Python) are detected and safely skipped.

  Also fixes truncated lesson headings — `generateLessonHeading` no longer appends ellipsis on truncation, and the extract prompt uses positive structural constraints for better LLM compliance.

## 0.23.0

### Minor Changes

- 83923f0: Add native Ollama orchestrator provider with dynamic `num_ctx` support
  - New `provider: 'ollama'` orchestrator config hits Ollama's native `/api/chat` endpoint directly via fetch (no SDK required)
  - Supports `numCtx` option to dynamically control context length and VRAM usage per-command
  - VRAM-friendly error messages on 500 errors suggest lowering `numCtx`
  - Connection errors suggest running `ollama serve`
  - Mirrors the existing `ollama-embedder` pattern (plain fetch, baseUrl defaulting)

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

## 0.20.0

### Minor Changes

- fff1f27: Inline suppression directives (`totem-ignore` / `totem-ignore-next-line`) for deterministic shield, cross-provider `provider:model` routing with negated glob support, and relicense to Apache 2.0.

## 0.19.0

### Minor Changes

- feat: discriminated union config and fileGlobs scoping
  - Extract shared orchestrator interface with discriminated union config schema
  - Add `fileGlobs` scoping for compiled shield rules

## 0.18.0

### Minor Changes

- feat: async orchestrator and ReDoS protection
  - Refactored shell orchestrator from `execSync` to async `spawn` with streaming stdout/stderr, 50MB safety cap, and proper timeout handling (#206)
  - Added compile-time ReDoS static analysis via `safe-regex2` — vulnerable regex patterns are rejected during `totem compile` with diagnostic reasons (#218)
  - Graceful per-doc error handling in `totem docs` — a single doc failure no longer aborts the entire batch

## 0.17.0

### Minor Changes

- 03372b4: feat: drift detection for self-cleaning memory (#181)

  Adds `totem sync --prune` to detect and interactively remove lessons with stale file references. The drift detector scans `.totem/lessons.md` for backtick-wrapped file paths that no longer exist in the project, then presents an interactive multi-select for pruning. After pruning, the vector index is automatically re-synced.

  New core exports: `parseLessonsFile`, `extractFileReferences`, `detectDrift`, `rewriteLessonsFile`.

## 0.16.1

## 0.16.0

### Minor Changes

- 76b4cf4: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

## 0.15.0

### Minor Changes

- Universal baseline lessons during `totem init` (#128), orphaned temp file cleanup on CLI startup (#108), and automated doc sync via `totem docs` command (#190) integrated into `totem wrap` as Step 4/4.

## 0.14.0

### Minor Changes

- 171a810: Minimum viable configuration tiers (Lite/Standard/Full). Embedding is now optional — Lite tier works with zero API keys. Auto-detects OPENAI_API_KEY during `totem init`.

## 0.13.0

## 0.12.0

## 0.11.0

### Minor Changes

- Configurable `contextWarningThreshold` in `TotemConfigSchema` (default: 40,000 chars)

## 0.10.0

### Minor Changes

- e97f5cd: feat: add heading hierarchy breadcrumbs to MarkdownChunker labels
  - Chunk labels now include full heading hierarchy (e.g. "Parent > Child") instead of just the nearest heading (#127)
  - Improves retrieval context quality for `totem spec` and `totem shield` outputs
  - Matches breadcrumb pattern already established in SessionLogChunker

## 0.9.2

### Patch Changes

- 373f872: fix: sync reliability and unified XML escaping
  - Persistent sync state tracking via .totem/cache/sync-state.json — no more missed changes (#155)
  - Deleted files are now purged from LanceDB during incremental sync (#156)
  - Unified wrapXml utility in @mmnto/core with consistent backslash escaping (#158)

## 0.9.1

## 0.9.0

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

## 0.7.0

### Minor Changes

- Unify gh-utils and PrAdapter, comprehensive test audit, bug fixes
  - Extracted shared `gh-utils` with `ghFetchAndParse` and `handleGhError`
  - Added `PrAdapter` abstraction for PR data fetching
  - Added unit tests for all adapters, orchestrator, and CLI commands
  - Fixed maxBuffer overflow on paginated GitHub API responses
  - Added GitHub API rate limit detection
  - Simplified ZodError messages for better UX

## 0.6.0

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.2

### Patch Changes

- fix: add apache-arrow as a direct dependency to satisfy lancedb peer requirement

## 0.2.1

### Patch Changes

- Harden orchestrator prompts with stronger personas (Red Team Reality Checker, Staff Architect, strict PM) and upgrade spec/shield/triage model overrides to gemini-3.1-pro-preview.

## 0.2.0

### Minor Changes

- 87a465a: Initial release — Phases 1-3 complete.
  - Core: LanceDB vector store, 5 syntactic chunkers (TS AST, markdown, session log, schema, test), OpenAI + Ollama embedding providers, full ingest pipeline with incremental sync
  - CLI: `totem init`, `totem sync`, `totem search`, `totem stats`
  - MCP: `search_knowledge` and `add_lesson` tools over stdio

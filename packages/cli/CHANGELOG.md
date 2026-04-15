# @mmnto/cli

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

- 12115e9: Refresh `compile-manifest.json` on pure input-hash drift (#1337)

  `totem lesson compile`'s no-op branch (introduced in #1281) refreshed the manifest only when `rulesPruned > 0 || drained > 0`. That left a gap: if a user deleted a lesson file whose rule was already absent from `compiled-rules.json` — or edited the lesson set in any way that produced zero prune/drain churn but shifted the `lessonsDir` hash — the manifest's `input_hash` stayed stale. `totem verify-manifest` then failed on the next `git push`, and the only recovery was `totem lesson compile --force` (~19 minutes of non-deterministic LLM calls on a mid-size repo).

  The no-op branch now explicitly compares `generateInputHash(lessonsDir)` against the existing manifest's `input_hash` and refreshes the manifest on drift, even when no rules were pruned. The refresh is carefully partitioned: `compiled-rules.json` is still rewritten only when actual pruning happened, so a pure drift refresh does not spuriously touch the rules file or invalidate downstream mtime-based caches.

  Missing or invalid `compile-manifest.json` is also handled — `readCompileManifest` wraps `ENOENT` via `readJsonSafe` into `TotemParseError` today, and a defensive raw-ENOENT fallback guards against future refactors of the core API. The missing-manifest path is locked in by an integration test in `compile-noop-refresh.test.ts`.

- Updated dependencies [55a7e19]
  - @mmnto/totem@1.14.4

## 1.14.3

### Patch Changes

- Updated dependencies [0b3e274]
  - @mmnto/totem@1.14.3

## 1.14.2

### Patch Changes

- e022109: Use `[Review]` as the log prefix for `totem review` output (#1335)

  The `totem review` command was still printing `[Shield]` as the log prefix on every status line — a holdover from before the `shield` → `review` rename. Added a new `DISPLAY_TAG = 'Review'` constant in `shield-templates.ts` and routed every `log.info` / `log.dim` / `log.warn` / `log.success` call through it. The existing `TAG = 'Shield'` constant is kept verbatim because it's still used as the lookup key for `orchestrator.overrides.shield` and `orchestrator.cacheTtls.shield` in user configs — a coordinated rename of the routing key is tracked in #1335.

  User-visible effect: `totem review` output now prints `[Review]` instead of `[Shield]`. No config migration required.
  - @mmnto/totem@1.14.2

## 1.14.1

### Patch Changes

- 30971d7: Prune stale `nonCompilable` entries on no-op compile runs (#1281)

  `totem lesson compile` was only draining stale entries from the `nonCompilable` cache when there was actual compile work to do. On a no-op run (all lessons already compiled), stale entries — left over from lessons that had been edited or removed in a previous run — survived forever until some future run happened to have real work.

  The prune logic is now extracted into a pure helper (`pruneStaleNonCompilable`) and called from both branches. The no-op path only rewrites `compiled-rules.json` when there's actually something to drain, so genuinely idle runs still don't touch the file.

  Closes #1281. Discovered during the #1264 E2E reproduction.

- b76128e: 1.14.1 — Hotfix sweep (#1311)

  Bundled fixes for four post-1.14.0 regressions surfaced during the first day of 1.14.0 in production:
  - **#1304** — `totem review` and `totem lint` were running rules against on-disk content instead of staged content when files had unstaged modifications. The rule engine now loads staged blob content via `git show :path` when a path is in the index, and reads from the filesystem only when the path is unstaged. Path containment is also hardened to reject symlinks that escape the repo root.
  - **#1305** — `lance-search` predicates were failing on any field name containing a SQL keyword or dash (`source-repo`, `file-type`) because the generated `WHERE` clause lacked backtick quoting. Field identifiers are now backtick-wrapped consistently.
  - **#1306** — AST engine test coverage audit found an uncovered branch in `ast-query` that silently returned an empty result set for malformed tree-sitter query strings. It now throws a descriptive error so `totem compile` can surface the broken rule instead of silently dropping it.
  - **#1309** — `totem doctor` and `totem lint` were still printing the legacy `totem review --fix` hint after that flag was removed in 1.12. Updated to the current `totem review --apply` form.

- b76128e: Queue drain: Shield branding consistency (#1313)

  Three small queue-drain items bundled into one PR (#1298, #1299, #1302):
  - **#1298** — `totem shield` output and `totem --help` entries now consistently use "Shield" branding instead of the legacy "AI Shield" and "shield" mix that had crept in over several releases.
  - **#1299** — `/preflight` skill doc-scope expanded to cover the cases where preflight was routinely producing "draft from memory" outputs instead of searching the knowledge base first.
  - **#1302** — Dual-hash convention documented in `.gemini/styleguide.md` so cross-agent review produces consistent pattern/content hash formatting.

- b76128e: Resolve non-staged AST paths against repo root, not cwd (#1314)

  `totem review` was resolving AST engine file paths relative to the current working directory instead of the repo root when evaluating non-staged files, causing false misses for any invocation from a subdirectory. The resolver now consistently anchors against the repo root for both staged and non-staged paths. Fixes #1312.

- b76128e: Refactor `totem handoff` to a deterministic journal scaffold (#1316)

  `totem handoff` previously generated its output via an LLM call, which made the command slow, non-reproducible, and gated on provider availability. It's now a deterministic scaffold: the command reads git state, recent commits, and the active journal directory, then writes a pre-filled template the user (or an agent) can flesh out.

  Closes #1310. Also removes ~500 lines of dead orchestration code that was only used by the old LLM path.

- b76128e: Rename `totem handoff --no-edit` to `--stdout` (#1325)

  **User-visible CLI change.** The `--no-edit` flag on `totem handoff` never worked: Commander.js interpreted it as a boolean negation of a nonexistent `--edit` option, so passing `--no-edit` silently set an unrelated field to `false` and the command still tried to open `$EDITOR`. The flag has been renamed to `--stdout` (with `--lite` kept as an alias) which unambiguously prints the scaffold to stdout.

  Anyone who was passing `--no-edit` was getting the default behavior anyway, so there is no functional regression — just a rename to something that actually works. Fixes #1317. Also deletes the orphaned `handoff-checkpoint` schema files that were stranded when #1316 removed the LLM-path code that referenced them (#1318).

- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
- Updated dependencies [b76128e]
  - @mmnto/totem@1.14.1

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

### Patch Changes

- Updated dependencies [11ab03b]
  - @mmnto/totem@1.14.0

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

### Patch Changes

- Updated dependencies [0b08629]
  - @mmnto/totem@1.13.0

## 1.12.0

### Minor Changes

- c4f9746: 1.12.0 — The Umpire & The Router
  - Standalone binary: lite-tier distribution works without Node.js, using @ast-grep/wasm for full AST rule coverage across linux-x64, darwin-arm64, win32-x64
  - Ollama auto-detection: `totem init` detects local Ollama and defaults to gemma4 for classification
  - ast-grep for ESLint properties: `no-restricted-properties` import uses precision AST matching
  - Lazy WASM init: AST engine only initializes when lint/test commands need it
  - GHA injection rule scope: narrowed to `run:` contexts, no false positives in `env:`/`with:` blocks
  - Windows CI stability: fixed flaky orchestrator timeout

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

- 8e5ede0: fix: deduplicate exemption sampleMessages and narrow process.exit() rule scope
- 1f01269: fix: refactor monorepo hook templates for strict POSIX sh compliance
- bf80dc1: chore: audit and refine 5 conflicting compiled rules from 1.10.0 batch
  - @mmnto/totem@1.10.1

## 1.10.0

### Minor Changes

- f9623a4: ## 1.10.0 — The Invisible Exoskeleton

  Reduce adoption friction for new users and solo developers.

  ### Features
  - **Pilot mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes). State tracked in `.totem/pilot-state.json`.
  - **Enforcement tiers (#987):** Strict tier with spec-completed check + shield gate. Agent auto-detection via environment variables.
  - **Solo dev experience (#1039):** `totem extract --local` for local git diffs. Global profile override (`~/.totem/`) with `totem init --global`.

  ### Fixes
  - **.env parser (#1114):** Replaced custom regex with `dotenv` library in CLI and MCP packages.
  - **Spec infrastructure (#1016):** Query expansion for test-related keywords + docstring enrichment.
  - **Manifest rehash (#1155):** Pipeline 5 observation capture now re-hashes compile manifest after mutation.
  - **Pre-push format check (#1156):** `format:check` added to pre-push hook template. Package-manager-agnostic detection.
  - **Exit code fix (#1161):** `--yes` mode now sets `process.exitCode = 1` when all lessons are suspicious.

  ### Internal
  - **Extract refactor (#1159):** Split 1,165-line extract.ts into 5 focused modules with unified assembler.
  - **"Missed Caught" audit (#1153):** Historical bot findings categorized by detection tier (44% deterministic).

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

- 9a6a1a0: Add Pipeline 5 observation-based auto-capture from shield findings
- Updated dependencies [9a6a1a0]
  - @mmnto/totem@1.8.5

## 1.8.4

### Patch Changes

- 1bb150d: Add Pipeline 3 example-based compilation prompt for Bad/Good code snippet lessons
- Updated dependencies [1bb150d]
  - @mmnto/totem@1.8.4

## 1.8.3

### Patch Changes

- ea9e7f2: Add `--from-scan` flag to `totem lesson extract` for extracting lessons from fixed code scanning alerts
  - @mmnto/totem@1.8.3

## 1.8.2

### Patch Changes

- 11f4512: Add pre-compiled baseline rules for Python (4), Rust (3), and Go (2) ecosystems
- Updated dependencies [11f4512]
  - @mmnto/totem@1.8.2

## 1.8.1

### Patch Changes

- f088d68: feat: prior art concierge for `totem spec` (#1015)

  Injects shared helper signatures into the spec prompt so agents discover existing utilities (safeExec, readJsonSafe, git helpers, maskSecrets) instead of reimplementing them.

- f088d68: feat: intelligent scope inference for `totem extract` (#1014)

  Analyzes PR changed files and pre-injects a scope suggestion into the extraction prompt so the LLM produces better file glob scopes on extracted lessons.

- Updated dependencies [f088d68]
- Updated dependencies [f088d68]
  - @mmnto/totem@1.8.1

## 1.8.0

### Minor Changes

- 4d87c56: feat: auto-scaffold test fixtures for Pipeline 1 rules (#854) and shield auto-learn (#779)
  - Pipeline 1 error rules now auto-generate test fixture skeletons during compile, preserving error severity instead of downgrading to warning (ADR-065)
  - New `totem rule scaffold <id>` command for manual fixture generation with `--out` option
  - Fixtures seeded from Example Hit/Miss when available, otherwise TODO placeholders
  - New `shieldAutoLearn` config option: when true, shield FAIL verdicts auto-extract lessons without `--learn` flag

### Patch Changes

- Updated dependencies [4d87c56]
  - @mmnto/totem@1.8.0

## 1.7.2

### Patch Changes

- 8fe2329: feat: rule garbage collection and compile progress indicator (#1040, #894)
  - `totem doctor --pr` now archives stale compiled rules (zero triggers after configurable minAgeDays). Opt-in via `garbageCollection` config block. Security-category rules are exempt.
  - `totem compile` now shows elapsed time and ETA with throughput-based estimation. Rate-limited LLM calls (429) are automatically retried with jittered exponential backoff.

- Updated dependencies [8fe2329]
  - @mmnto/totem@1.7.2

## 1.7.1

### Patch Changes

- f2331ce: feat: structured session checkpoints for totem handoff (#914)

  `totem handoff` now emits a Zod-validated JSON checkpoint alongside the Markdown output. Deterministic fields (branch, active_files) come from git; semantic fields (completed, remaining, pending_decisions, context_hints) are parsed from the LLM Markdown. Lite mode gracefully degrades with empty semantic arrays. Checkpoint writes are atomic (tmp+rename).
  - @mmnto/totem@1.7.1

## 1.7.0

### Minor Changes

- c236cac: Developer Experience milestone: redesigned help output with command grouping and [LLM] badges, --json global flag for structured CLI output, totem hooks --force for hook regeneration, triage-pr multi-nit parsing fix, Sensors vs Actuators documentation.

### Patch Changes

- @mmnto/totem@1.7.0

## 1.6.3

### Patch Changes

- 4c5696f: Gate architecture reset (Proposal 207): replaced SHA-based flag files with stateless git hooks (lint + verify-manifest) and content-hash-based PreToolUse review gate. Added SessionStart hook for automatic knowledge context injection. Removed all flag files (.lint-passed, .shield-passed, .spec-completed) and Claude hook enforcement scripts.
  - @mmnto/totem@1.6.3

## 1.6.2

### Patch Changes

- 2a5674f: Push gate simplification (Proposal 206): rewrite pre-push hook as fast read-only checkpoint, add ancestry-aware lint validation with .target-globs cache, diagnostic hook output, and ticket-aware spec gate. totem lint now writes .lint-passed and .target-globs cache files for the hook.
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

- 7cd543a: feat: exemption engine, auto-ticket deferred, interactive triage
  - Exemption Engine (#917): dual-storage FP tracking (local + shared), 3-strike auto-promotion, --suppress flag, bot review integration
  - Auto-ticket (#931): createDeferredIssue service with idempotency, milestone inference, thread reply
  - Interactive Triage (#958): Clack prompts for PR triage with fix/defer/dismiss actions
  - Ledger: 'exemption' event type for audit trail
  - Bot review parser: extractPushbackFindings, shared PUSHBACK_PATTERNS constant

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

- 19de6b1: feat: categorized triage UX for bot review comments (#956)
  feat: doctor --pr — autonomous rule downgrading (#961)
  feat: auto-format staged files in pre-commit hook
- Updated dependencies [19de6b1]
  - @mmnto/totem@1.5.5

## 1.5.4

### Patch Changes

- 7f5d4e7: feat: user-defined secrets — custom DLP patterns (#921)
  feat: Local Trap Ledger — capture exceptions to NDJSON (#960)
  feat: /review-learn — extract lessons from bot PR reviews (#930)
  fix: SARIF output emits error-severity findings only
  fix: SARIF warning summary as single note annotation
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

### Patch Changes

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

- God Object cleanup: extract.ts (804→566), shield.ts (587→475), audit.ts (560→510), lance-store.ts (523→285). Suspicious lesson detection + semantic dedup moved to core. Nit extraction from CodeRabbit review bodies. Compiler quality gate for untested error rules. Wind tunnel CI gate.
- Updated dependencies
  - @mmnto/totem@1.3.17

## 1.3.16

### Patch Changes

- Universal Baseline grows from 15 → 23 rules (8 Gemini-validated ast-grep patterns). Wind tunnel: 9 test fixtures + ast-grep test runner fix. Adversarial corpus (16 clean-room fixtures). TypeScript detection for monorepo per-package tsconfig.json.
- Updated dependencies
  - @mmnto/totem@1.3.16

## 1.3.15

### Patch Changes

- Rule audit Phase 4: kill bad patterns, scope noisy rules, extract lessons from PR 816. Full audit progression: 2,713 → 555 violations (0 on enforcement path).
- Updated dependencies
  - @mmnto/totem@1.3.15

## 1.3.14

### Patch Changes

- Rule audit: kill 70 garbage rules, dedup 18 overlaps (327 → 239). Docs prompt fix: strip issue refs from user-facing output. README cleanup.
- Updated dependencies
  - @mmnto/totem@1.3.14

## 1.3.13

### Patch Changes

- Spec template tests (#805), spec/compile prompt extraction (#806, #799), compiler utility tests, prompt versioning, post-compact gate strengthening
- Updated dependencies
  - @mmnto/totem@1.3.13

## 1.3.12

### Patch Changes

- Agent workflow doc, spec straitjacket upgrade (militant red flags + Graphviz), lean GEMINI.md, PostCompact agent discipline reminder
- Updated dependencies
  - @mmnto/totem@1.3.12

## 1.3.11

### Patch Changes

- 0b47c94: Security hardening: regex escape, shell:true removal, SQL backtick escape. CodeRabbit integration with path instructions. onWarn logging for AST catch blocks. Unsafe non-null assertions replaced.
- Updated dependencies [0b47c94]
  - @mmnto/totem@1.3.11

## 1.3.10

### Patch Changes

- ceb8663: Context engineering (ADR-063): lean CLAUDE.md router pattern, PostCompact capability manifest, phase-gate enforcement (spec warning before commit). Fixed doc regen hallucination loop.
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

- 6a2eb4c: Lesson linter with pre-compilation gate, spec straitjacket format (TDD forcing + inline invariants), cross-platform CI matrix.
- Updated dependencies [6a2eb4c]
  - @mmnto/totem@1.3.7

## 1.3.6

### Patch Changes

- 09153f8: Pipeline 1 backfill: 127 curated rules now compile deterministically (zero LLM). Added .totem/lessons/ to .prettierignore. Workflow automation hooks and skills for Claude Code.
- Updated dependencies [09153f8]
  - @mmnto/totem@1.3.6

## 1.3.5

### Patch Changes

- 5810bcc: ### Knowledge Quality & Security
  - All 59 universal baseline lessons now include actionable Fix guidance — agents know HOW to resolve violations, not just WHAT is wrong (#642)
  - Path traversal containment check using path.relative prevents reads outside the project directory (#738)
  - Traversal skip now logs a warning via onWarn callback for visibility (#739)

- Updated dependencies [5810bcc]
  - @mmnto/totem@1.3.5

## 1.3.4

### Patch Changes

- 98d56dc: ### Security & Compiler Hardening
  - `totem link` now requires explicit consent ("I understand") before creating cross-trust-boundary bridges. Bypass with `--yes` for CI/CD.
  - Shell orchestrator process termination uses process groups on Unix (prevents zombie processes)
  - SECURITY.md expanded with threat model, audit results, and Totem Mesh risks
  - Gate 1 (Proposal 184): Compiled rules now default to `severity: 'warning'` when LLM omits severity, preventing the #1 compiler regression
  - Added `severity` field to `CompilerOutputSchema`

- Updated dependencies [98d56dc]
  - @mmnto/totem@1.3.4

## 1.3.3

### Patch Changes

- 167737c: ### Launch Polish
  - README: Added "Why Totem" pillars, "Works Without AI" table, and "Totem Mesh" section — all front-and-center
  - Dynamic baseline rule count in post-init message (was hardcoded)
  - Linked store queries now distinguish network vs config errors (#666)
  - Suppressed expected stderr noise in docs.test.ts (#547)
  - console.log → console.error consistency in install-hooks.ts
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

### Patch Changes

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

### Minor Changes

- ab254bf: feat: migrate 54 throw sites to TotemError hierarchy

  Every error now includes a `recoveryHint` telling the user exactly how to fix it. New error classes: `TotemOrchestratorError`, `TotemGitError`. New error code: `GIT_FAILED`. Includes rule fix exempting error class imports from the static import lint rule.

### Patch Changes

- Updated dependencies [ab254bf]
  - @mmnto/totem@0.44.0

## 0.43.0

### Minor Changes

- a19bbca: feat: Universal Baseline — 60 battle-tested lessons ship with `totem init`

  Every new project now gets immediate Day-1 protection against the most common architectural traps, extracted from real PR reviews in Next.js, React, Prisma, Tailwind, and Drizzle. Includes 5 AI-assisted workflow guardrails (scope isolation, Rule of Three, no silent TODO, no monolithic files, no unauthorized refactors). Backward-compatible with existing baseline installations.

### Patch Changes

- @mmnto/totem@0.43.0

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

### Patch Changes

- Updated dependencies [557d046]
  - @mmnto/totem@0.42.0

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

### Patch Changes

- Updated dependencies [028786b]
  - @mmnto/totem@0.41.0

## 0.40.0

### Minor Changes

- 99f8995: feat: .mdc / .cursorrules ingestion adapter (#555)

  New `totem compile --from-cursor` flag. Scans .cursor/rules/\*.mdc, .cursorrules, and .windsurfrules files. Parses frontmatter and plain text rules. Compiles them into deterministic Totem rules via the existing LLM pipeline.

  docs: README Holy Grail positioning (ADR-049)

  "A zero-config CLI that compiles your .cursorrules into deterministic CI guardrails. Stop repeating yourself to your AI." MCP as step 2, Solo Dev Superpower section, command table with speed metrics.

### Patch Changes

- Updated dependencies [99f8995]
  - @mmnto/totem@0.40.0

## 0.39.0

### Minor Changes

- dda8715: feat: shield severity levels — error vs warning (#498)

  Rules now support `severity: 'error' | 'warning'`. Errors block CI, warnings inform but pass. SARIF output maps severity to the `level` field. JSON output includes error/warning counts.

  chore: rule invariant audit — 137 rules categorized (#556)

  27 security (error), 56 architecture (error), 47 style (warning), 7 performance (warning). 39% reduction in hard blocks while maintaining all guidance.

  fix: auto-healing DB — dimension mismatch + version recovery (#500, #548)

  LanceStore.connect() auto-heals on embedder dimension mismatch and LanceDB version/corruption errors. Nukes .lancedb/ and reconnects empty for a clean rebuild.

### Patch Changes

- Updated dependencies [dda8715]
  - @mmnto/totem@0.39.0

## 0.38.0

### Minor Changes

- 89fcb02: feat: Trap Ledger Phase 1 — SARIF extension + enhanced totem stats

  Every `totem lint` violation now generates SARIF properties with eventId, ruleCategory, timestamp, and lessonHash. Rules support a `category` field (security/architecture/style/performance). `totem stats` shows "Total violations prevented" with category breakdown and top 10 prevented violations.

  fix: code review blitz — 7 findings from Claude+Gemini synthesis

  Critical: MCP loadEnv quote stripping, add_lesson race condition (promise memoization), SARIF format flag works with totem lint. High: extracted shared runCompiledRules (-75 lines), Gemini default model fixed, health check --rebuild → --full, lesson validation before disk write.

  fix: stale prompts — docs glossary, init model, reflex block v3

  Command glossary in docs system prompt prevents LLM confusing lint/shield. Gemini embedder model corrected in init. AI_PROMPT_BLOCK distinguishes lint (pre-push) from shield (pre-PR).

  chore: 137 compiled rules (39 new), 17 extracted lessons, docs sync

### Patch Changes

- Updated dependencies [89fcb02]
  - @mmnto/totem@0.38.0

## 0.37.0

### Minor Changes

- 382c77a: feat: `totem lint` — new command for fast compiled rule checks (zero LLM)

  Split from `totem shield`. `totem lint` runs compiled rules against your diff in ~2 seconds with no API keys needed. `totem shield` is now exclusively the AI-powered code review. `--deterministic` flag is deprecated with a warning.

  feat: semantic rule observability (Phase 1)

  Rules now track `createdAt`, `triggerCount`, `suppressCount`, and `lastTriggeredAt` metadata. `totem stats` displays rule metrics. Foundation for automated rule decay analysis.

  fix: shield rule scoping — dynamic import and match/exec rules narrowed

  Dynamic import rule scoped to command files only (not adapters/orchestrators). match/exec rule scoped to security-sensitive code only. `.cjs` rule excludes CI workflow YAML.

### Patch Changes

- Updated dependencies [382c77a]
  - @mmnto/totem@0.37.0

## 0.36.0

### Minor Changes

- 74e521e: feat: graceful degradation for orchestrator and embedder providers

  Orchestrators (Gemini, Anthropic) now fall back to their CLI equivalents when the SDK or API key is missing. Embedders fall back to Ollama when the configured provider is unavailable. LazyEmbedder uses promise memoization to prevent race conditions with concurrent embed() calls.

  feat: configurable issue sources — support multiple repos in triage/extract/spec

  Add `repositories` field to `totem.config.ts`. When set, triage, audit, and spec commands aggregate issues from all listed repos. Supports `owner/repo#123` syntax for disambiguation.

  chore: switch default embedder to Gemini (gemini-embedding-2-preview)

  Task-type aware 768d embeddings replace OpenAI text-embedding-3-small (1536d). Requires `totem sync --full` after upgrade.

### Patch Changes

- Updated dependencies [74e521e]
  - @mmnto/totem@0.36.0

## 0.35.1

### Patch Changes

- 9cd061e: Bug blitz: four fixes from triage priorities.
  - **#396:** Anthropic orchestrator uses model-aware max_tokens (Haiku 4K, Sonnet 8K, Opus 16K)
  - **#397:** matchesGlob now supports single-star directory patterns (e.g., `src/*.ts`)
  - **#398:** extractChangedFiles handles quoted paths with spaces
  - **#399:** AST gate reads staged content (`git show :path`) before falling back to disk

- Updated dependencies [9cd061e]
  - @mmnto/totem@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [f6074c4]
  - @mmnto/totem@0.35.0

## 0.34.0

### Minor Changes

- 7ae97f9: Add Copilot and Junie to totem init agent detection.
  - **Init:** Auto-detect JetBrains Junie (`.junie/`) and GitHub Copilot (`.github/copilot-instructions.md`)
  - **Init:** Correct Junie MCP path to `.junie/mcp/mcp.json` (was incorrectly using `.mcp.json`)
  - **Init:** Copilot gets reflex injection only (no MCP — Copilot doesn't support it)

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

### Patch Changes

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

### Minor Changes

- d0be9c6: Add compile --export as Step 5 of totem wrap, exclude export targets from deterministic shield, throw NoLessonsError in compile command

### Patch Changes

- Updated dependencies [d0be9c6]
  - @mmnto/totem@0.30.0

## 0.29.0

### Minor Changes

- e311aff: Lesson injection into all orchestrator commands, totem audit, and Junie docs.
  - **`totem audit`** — strategic backlog audit with human approval gate, interactive multi-select, shell injection prevention via `--body-file`, resilient batch execution (#362)
  - **Lesson injection** — vector DB lessons now injected into shield (full bodies), triage (condensed), and briefing (condensed) via shared `partitionLessons()` + `formatLessonSection()` helpers (#370)
  - **Junie docs** — MCP config example and export target docs in README (#371)
  - **Lesson ContentType** — `add_lesson` MCP tool now uses `lesson` content type for better vector DB filtering (#377)
  - **Versioned reflex upgrade** — `REFLEX_VERSION=2` with `detectReflexStatus()` and `upgradeReflexes()` for existing consumers (#375)
  - **Spec lesson injection** — lessons injected as hard constraints into `totem spec` output (#366)

### Patch Changes

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

- 8c7cda9: Add formatting rules to totem docs system prompt to prevent monster single-line phase summaries
- c67495e: Fix false positives in suspicious lesson detection for security-related lessons
  - @mmnto/totem@0.26.1

## 0.26.0

### Minor Changes

- ac9f37e: Add `totem hooks` command for non-interactive hook installation with `--check` validation. Dogfood enforcement hooks in this repo: pre-commit blocks main/master, pre-push runs deterministic shield. Hooks auto-install on `pnpm install` via prepare script.

### Patch Changes

- 16849b4: fix: `totem hooks` now walks up to git root in monorepo sub-packages
  - @mmnto/totem@0.26.0

## 0.25.0

### Minor Changes

- 0455d24: Adversarial ingestion scrubbing, eval harness, Bun support, and model audit
  - **Adversarial ingestion scrubbing:** `sanitizeForIngestion()` strips BiDi overrides (Trojan Source defense) from all content types and invisible Unicode from prose chunks. Suspicious patterns flagged via `onWarn` but never stripped. Detection regexes consolidated into core for DRY reuse. XML tag regex hardened against whitespace bypass.
  - **Adversarial evaluation harness:** Integration tests with planted architectural violations for model drift detection. Deterministic tests run without API keys; LLM tests gated behind `CI_INTEGRATION=true` for nightly runs against Gemini, Anthropic, and OpenAI.
  - **Bun support:** `detectTotemPrefix()` checks for both `bun.lockb` (legacy) and `bun.lock` (Bun >= 1.2). Priority: pnpm > yarn > bun > npx.
  - **Model audit:** Updated default orchestrator model IDs — Anthropic to `claude-sonnet-4-6`, OpenAI to `gpt-5.4`/`gpt-5-mini`.
  - **Supported models doc:** New `docs/supported-models.md` with provider model listing APIs and discovery scripts.

### Patch Changes

- Updated dependencies [0455d24]
  - @mmnto/totem@0.25.0

## 0.24.0

### Minor Changes

- 3b8e53b: feat: git hook enforcement — block main commits + deterministic shield gate

  `totem init` now installs two enforcement hooks alongside the existing post-merge hook:
  - **pre-commit**: blocks direct commits to `main`/`master` (override with `git commit --no-verify`)
  - **pre-push**: runs `totem shield --deterministic` before push, bails instantly if no compiled rules exist (zero Node startup penalty for Lite tiers)

  Both hooks are idempotent, chain-friendly (append to existing hooks without clobbering), and cross-platform. Non-shell hooks (Node/Python) are detected and safely skipped.

  Also fixes truncated lesson headings — `generateLessonHeading` no longer appends ellipsis on truncation, and the extract prompt uses positive structural constraints for better LLM compliance.

### Patch Changes

- Updated dependencies [3b8e53b]
  - @mmnto/totem@0.24.0

## 0.23.0

### Minor Changes

- 83923f0: Add native Ollama orchestrator provider with dynamic `num_ctx` support
  - New `provider: 'ollama'` orchestrator config hits Ollama's native `/api/chat` endpoint directly via fetch (no SDK required)
  - Supports `numCtx` option to dynamically control context length and VRAM usage per-command
  - VRAM-friendly error messages on 500 errors suggest lowering `numCtx`
  - Connection errors suggest running `ollama serve`
  - Mirrors the existing `ollama-embedder` pattern (plain fetch, baseUrl defaulting)

- 53eda11: feat: `shield --learn` extracts lessons from failed verdicts (#303) and reduces false positives in suspicious lesson detection (#302)

  **Shield --learn:** When a Shield LLM verdict fails, passing `--learn` runs a second extraction pass to distill systemic architectural lessons from the review. Supports `--yes` for unattended CI use (suspicious lessons are auto-dropped). Lessons are appended to `.totem/lessons.md` and immediately re-indexed.

  **False positive reduction:** The instructional leakage heuristic now requires an attack verb (ignore, disregard, reveal, etc.) in proximity to a sensitive target (system prompt, previous instructions, etc.), preventing false positives on educational lessons that merely discuss security patterns.

- 5418aae: Add suspicious lesson detection to `totem extract` with `--yes` mode blocking
  - New `flagSuspiciousLessons()` heuristic validator detects prompt injection indicators: instructional leakage, XML tag leakage, Base64 payloads, excessive unicode escapes, and overly long headings
  - Interactive UI marks suspicious lessons with `[!]` prefix and deselects them by default
  - `--yes` mode automatically blocks suspicious lessons with warnings and exits non-zero for CI pipelines
  - Dry-run mode surfaces suspicious flags in preview output

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

### Minor Changes

- fff1f27: Individual document targeting for `totem docs`, centralized `resolveOrchestrator()` with model name security validation, fix for truncated lesson extraction headings, cross-provider routing support, docs pipeline stability fixes, and relicense to Apache 2.0.

### Patch Changes

- Updated dependencies [fff1f27]
  - @mmnto/totem@0.20.0

## 0.19.0

### Minor Changes

- feat: native API orchestrators for Gemini and Anthropic SDKs
  - Add `gemini` and `anthropic` orchestrator providers for direct SDK calls (BYOSD)
  - Extract shared orchestrator interface with discriminated union config
  - Add `isQuotaError` shared utility and `detectPackageManager` for BYOSD prompts
  - Add `fileGlobs` scoping for compiled shield rules
  - Add XML sentinel validation for `totem docs` responses

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

### Minor Changes

- 03372b4: feat: drift detection for self-cleaning memory (#181)

  Adds `totem sync --prune` to detect and interactively remove lessons with stale file references. The drift detector scans `.totem/lessons.md` for backtick-wrapped file paths that no longer exist in the project, then presents an interactive multi-select for pruning. After pruning, the vector index is automatically re-synced.

  New core exports: `parseLessonsFile`, `extractFileReferences`, `detectDrift`, `rewriteLessonsFile`.

### Patch Changes

- Updated dependencies [03372b4]
  - @mmnto/totem@0.17.0

## 0.16.1

### Patch Changes

- c3a76cc: Fix `totem docs` aborting on large responses by adding maxBuffer (10MB) to execSync, matching the existing GitHub CLI adapter pattern. Adds descriptive error messages for buffer overflow and timeout failures.
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

### Minor Changes

- c177a1b: - **Shield GitHub Action (#180):** Added `action.yml` composite action for CI/CD enforcement — runs `totem sync` + `totem shield` as a pass/fail quality gate on PRs
  - **Rename CLI commands (#185):** `learn` → `extract`, removed `anchor` alias (use `add-lesson`), updated all docs and tests
  - **Interactive multi-select (#168):** `totem extract` now presents a `@clack/prompts` multi-select menu for cherry-picking lessons instead of all-or-nothing Y/n
  - **CI test step:** Added `pnpm test` to the CI workflow (was missing)

### Patch Changes

- @mmnto/totem@0.13.0

## 0.12.0

### Minor Changes

- 075680f: Add `totem bridge`, `totem eject`, and `totem wrap` commands
  - **`totem bridge`** — Lightweight, no-LLM context bridge for mid-session compaction. Captures git branch, modified files, and optional breadcrumb message.
  - **`totem eject`** — Clean reversal of `totem init`: scrubs git hooks, AI reflex blocks, Claude/Gemini hook files, and deletes Totem artifacts. Confirmation prompt with `--force` bypass.
  - **`totem wrap <pr-numbers...>`** — Post-merge workflow automation: chains `learn → sync → triage` with interactive TTY for lesson confirmation.

### Patch Changes

- @mmnto/totem@0.12.0

## 0.11.0

### Minor Changes

- Await sync in `add_lesson` with timeout for definitive success/failure confirmation
- Configurable `contextWarningThreshold` with system warnings on large payloads
- Condensed context for fast-boot commands (`briefing`, `triage`)
- Context Management Guardrail injected via `totem init` reflex templates

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

### Minor Changes

- cd7fe05: feat: seamless host integration — Gemini CLI & Claude Code hooks
  - hookInstaller infrastructure in `totem init` with idempotent scaffoldFile/scaffoldClaudeHooks utilities
  - Gemini CLI: SessionStart briefing hook, BeforeTool shield gate, Totem Architect skill
  - Claude Code: PreToolUse hook for shield-gating git push/commit
  - Cloud bot prompt refinement in AI_PROMPT_BLOCK for GCA integration
  - Enhanced `search_knowledge` tool description

### Patch Changes

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

### Minor Changes

- Shield: add security checklist (prompt injection, input sanitization, env injection) and enforce retrieved Totem lessons as strict review gate

### Patch Changes

- @mmnto/totem@0.6.0

## 0.5.0

### Minor Changes

- a91d8ac: Auto-scaffold MCP server configs during `totem init` for detected AI tools (Claude Code, Gemini CLI, Cursor)

### Patch Changes

- bf9ffaa: Fix MCP config scaffolding on Windows by wrapping `npx` with `cmd /c` (bare `npx` fails as a spawned command on win32)
  - @mmnto/totem@0.5.0

## 0.4.0

### Minor Changes

- Add evidence-based quality gate to `totem shield` — LLM now emits a structured PASS/FAIL verdict that gates CI and pre-push hooks with a non-zero exit code on failure.

### Patch Changes

- @mmnto/totem@0.4.0

## 0.3.0

### Minor Changes

- 80aaf73: feat: add `totem anchor` (and `totem add-lesson`) command to interactively add lessons to project memory and trigger a background re-index

### Patch Changes

- @mmnto/totem@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies
  - @mmnto/totem@0.2.2

## 0.2.1

### Patch Changes

- Harden orchestrator prompts with stronger personas (Red Team Reality Checker, Staff Architect, strict PM) and upgrade spec/shield/triage model overrides to gemini-3.1-pro-preview.
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

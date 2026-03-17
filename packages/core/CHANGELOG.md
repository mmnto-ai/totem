# @mmnto/totem

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

# @mmnto/cli

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

# @mmnto/mcp

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

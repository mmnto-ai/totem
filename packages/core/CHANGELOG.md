# @mmnto/totem

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

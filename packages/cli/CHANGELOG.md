# @mmnto/cli

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

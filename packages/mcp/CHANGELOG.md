# @mmnto/mcp

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

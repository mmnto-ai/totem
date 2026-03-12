# Gemini Styleguide for Totem (@mmnto/totem)

This document defines the architectural patterns, styling, and coding conventions for the `totem` repository. The Gemini Code Assist bot will use this to enforce rules during PR reviews.

## 1. Architectural Boundaries

- **Vector DB Abstraction:** All LanceDB interactions must remain strictly within the `@mmnto/totem` (core) package. The CLI and MCP packages must never import LanceDB directly.
- **MCP Stdio Restriction:** The `@mmnto/mcp` package must use the `@modelcontextprotocol/sdk` and communicate exclusively via stdio.
  - **CRITICAL:** Do NOT use `console.log` or `console.error` anywhere in the `@mmnto/mcp` package for debugging, as this will corrupt the stdio transport protocol. Use the MCP server's built-in logging mechanisms or write to a dedicated log file if necessary.

## 2. Naming Conventions (Vanilla Strategy)

We intentionally avoid metaphor-heavy names in the shipped code to ensure immediate developer comprehension.

- **DO USE:** `search_knowledge`, `add_lesson`, `totem init`, `totem sync`.
- **DO NOT USE:** `spin`, `anchor`, `kick`, `dream`. Those terms belong only in the philosophy section of the README.

## 3. TypeScript Rules

- **Strict Typing:** Avoid `any`. Use generics and strict interfaces for metadata injection.
- **Error Handling:** Use `try/catch` and throw clear, descriptive errors with the `[Totem Error]` prefix so the user understands exactly what went wrong.
  - _Example:_ `throw new Error('[Totem Error] No embedding provider configured. Set OPENAI_API_KEY in .env');`
- **File Extensions:** Use `.ts` for all files. No `.tsx` since this is a Node.js library without a UI.

## 4. Ingest Pipeline & Chunking

- When implementing syntactic chunking (e.g., AST parsing), chunks must always prepend a context header.
  - _Example Format:_ `File: <path> | Context: The '<name>' function

[Raw Code Chunk Here]`

- When parsing Markdown, heading hierarchy must be preserved in the chunks.
  - _Example Format:_ `[Heading 1 > Heading 2 > Heading 3] <content>`

## 5. Configuration Strategy

- Do not hardcode project-specific rules into the core engine.
- All dynamic settings (glob patterns, embedding providers, chunking strategies) must be read from the user's `totem.config.ts` file located at the root of the consuming project.

## 6. Do Not Suggest (Declined Patterns)

The following suggestions have been repeatedly declined during code review. Do not raise them again.

- **Zod for small parsers.** Do not suggest replacing manual validation with Zod schemas for simple LLM response parsing or small data structures (< 10 fields). Zod is used at system boundaries (config, API input), not for internal data transformers.
- **Configurable constants.** Do not suggest making hardcoded limits configurable (e.g., max search results, issue limits, context caps) unless the user explicitly needs runtime configurability. Named constants are sufficient.
- **`Promise.all` on tiny loops.** Do not suggest parallelizing loops that iterate over < 10 items with trivial operations. The overhead of `Promise.all` outweighs any benefit.
- **Async exec for sequential shell calls.** Do not suggest converting `execFileSync` to async `execFile` in CLI commands that run sequentially by design (e.g., batch GitHub mutations that must execute in order).
- **Import shared types across packages.** Types like `ContentType` already propagate from `@mmnto/totem` (core) to CLI and MCP via the dependency graph. Do not suggest creating shared type packages or re-exporting types.
- **Dynamic config loading for hardcoded paths.** Do not suggest making internal file paths (e.g., `.totem/lessons.md`, `.totem/compiled-rules.json`) configurable. These are structural constants of the Totem protocol.

## 7. Error Handling & Logging Conventions

- `log.error()` calls MUST use `'Totem Error'` as the tag — this is styleguide rule 21. Do not suggest changing it to the command-specific `TAG` constant.
- `log.info()`, `log.success()`, `log.warn()`, `log.dim()` use the command-specific `TAG` constant (e.g., `'Audit'`, `'Shield'`, `'Triage'`).
- Defense-in-depth guards in batch processing loops should use `log.warn()` + counter increments, NOT `throw`. The design intent is resilient continuation, not fail-fast. Only suggest `throw` for guards that should halt the entire operation.
- Library code (`@mmnto/totem` core) uses `onWarn` callbacks, never direct `console.warn`.

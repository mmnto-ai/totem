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
  - *Example:* `throw new Error('[Totem Error] No embedding provider configured. Set OPENAI_API_KEY in .env');`
- **File Extensions:** Use `.ts` for all files. No `.tsx` since this is a Node.js library without a UI.

## 4. Ingest Pipeline & Chunking
- When implementing syntactic chunking (e.g., AST parsing), chunks must always prepend a context header.
  - *Example Format:* `File: <path> | Context: The '<name>' function 

 [Raw Code Chunk Here]`
- When parsing Markdown, heading hierarchy must be preserved in the chunks.
  - *Example Format:* `[Heading 1 > Heading 2 > Heading 3] <content>`

## 5. Configuration Strategy
- Do not hardcode project-specific rules into the core engine.
- All dynamic settings (glob patterns, embedding providers, chunking strategies) must be read from the user's `totem.config.ts` file located at the root of the consuming project.
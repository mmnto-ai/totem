# Totem

**Totem** is a persistent memory and context layer for AI agents. Built on the Model Context Protocol (MCP), it replaces brute-force context stuffing with semantic retrieval over code, session history, specs, and Architectural Decision Records (ADRs).

## Philosophy: Anchor, Spin, Kick

While the shipped API relies on standard, self-documenting methods, the conceptual model for Totem relies on three metaphors:
- **Anchor (`add_lesson`):** Persist a key lesson, decision, or piece of knowledge. It commits an insight into the long-term context memory (`.totem/lessons.md`).
- **Spin (`search_knowledge` / `totem sync`):** Query the persistent index to pull relevant architectural guidance, code snippets, or session logs.
- **Kick (`reset`):** (Coming in Phase 5) Flush the ephemeral context, effectively resetting short-term memory while keeping anchored decisions intact.

## Architecture

Totem uses an embedded vector database (**LanceDB**) combined with customizable embedding models (OpenAI or Ollama) to index your project.

### Core Structure
This is a Turborepo monorepo consisting of:
- **`@mmnto/totem`** (`packages/core`): The core chunking logic and LanceDB interface.
- **`@mmnto/cli`** (`packages/cli`): The executable interface (`totem init`, `totem sync`).
- **`@mmnto/mcp`** (`packages/mcp`): The standard I/O MCP server for AI clients (like Claude and Gemini).

## Getting Started

1. **Initialize Totem** in your consuming project:
   ```bash
   npx @mmnto/cli init
   ```
   This will auto-detect your project structure (TypeScript, React, Markdown, etc.) and generate a `totem.config.ts`.

2. **Configure your Embedding Provider**:
   Totem defaults to OpenAI's `text-embedding-3-small`. You can configure this or switch to a local Ollama model (`nomic-embed-text`) in `totem.config.ts`.

3. **Sync the Index**:
   ```bash
   npx @mmnto/cli sync
   ```

4. **Configure the MCP Server**:
   Add Totem to your AI agent's configuration (e.g., Claude Desktop or Gemini):
   ```json
   {
     "mcpServers": {
       "totem": {
         "command": "npx",
         "args": ["-y", "@mmnto/mcp"]
       }
     }
   }
   ```

## Project Roadmap

- [x] **Phase 1: Scaffold** - Core monorepo setup, `totem init` CLI, and config schemas.
- [x] **Phase 2: Ingest Pipeline** - Chunking strategies (AST, Markdown, etc.) and `totem sync` indexing into LanceDB.
- [x] **Phase 3: MCP Server** - `search_knowledge` and `add_lesson` tool implementations over stdio.
- [x] **Phase 4: Workflow Integration** - Integration with dev loop tools (`pnpm oracle`, post-merge git hooks).
- [ ] **Phase 5: Ephemeral Memory** - The "Kick" (reset) functionality.

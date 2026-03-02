# Totem

**Your AI team forgets. Totem remembers.**

Developers are hitting the limits of "context stuffing." Brute-forcing a 2M token window with your entire codebase is slow, expensive, and leads to hallucinations.

**Totem** is a semantic memory layer and workflow orchestrator for your AI agents (Claude, Gemini, Cursor). Instead of blindly dumping files into a prompt, Totem gives your AI a local, version-controlled vector database. It teaches them to proactively remember your project's architectural decisions, domain constraints, and bug traps so you don't have to repeat yourself every session.

When you're three levels deep in a debugging session, you need to know if the code you are writing is real, or just an AI hallucinating an anti-pattern you banned three months ago. You need a totem.

## Why Totem?

- **Local-First & Git-Native:** Memory shouldn't be locked in a cloud SaaS. Totem compiles an embedded LanceDB vector index right inside your project (`.lancedb/`). The actual knowledge is stored in a human-readable, version-controlled `.totem/lessons.md` file. Review your AI's memory in your PRs.
- **The Reflex Engine:** Totem doesn't just give your AI a database; it gives them _reflexes_. `totem init` auto-injects behavioral triggers into your AI's system prompts (`CLAUDE.md`, `.cursorrules`), forcing them to autonomously document traps and query architecture before they write code.
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" and workflow orchestrator (via `totem spec`) for your entire AI org chart.

## Architecture

This is a Turborepo monorepo consisting of:

- **`@mmnto/totem`**: The core chunking logic (AST, Markdown headings, Session logs) and LanceDB interface.
- **`@mmnto/cli`**: The executable interface (`totem init`, `totem sync`).
- **`@mmnto/mcp`**: The standard I/O Model Context Protocol (MCP) server that exposes the `search_knowledge` and `add_lesson` tools to your AI.

## Getting Started

### 1. Initialize Totem

Run this inside your consuming project (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This will auto-detect your project structure, generate a `totem.config.ts`, install automated git hooks, and inject the Proactive Memory Reflexes into your AI's system prompt.

### 2. Configure your Embedding Provider

Totem defaults to OpenAI's `text-embedding-3-small` for a zero-friction start. You can configure this, or switch to a local Ollama model (`nomic-embed-text`), in `totem.config.ts`. Ensure your `.env` contains an `OPENAI_API_KEY` if using the default.

### 3. Sync the Index

```bash
npx @mmnto/cli sync
```

_(Note: If you accepted the git hook installation during `init`, Totem will automatically run incremental background syncs after every `git pull` or `git merge`)._

### 4. Connect the MCP Server

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

### 5. Generate Pre-Work Specs (The Orchestrator)

Totem can read a GitHub issue, query its vector DB for past architectural lessons and relevant code, and synthesize a complete pre-work briefing for your AI.

First, configure your orchestrator in `totem.config.ts`:

```typescript
// Use the Gemini CLI as your orchestrator
orchestrator: {
  provider: 'shell',
  command: 'gemini --model {model} --prompt "{file}"',
  defaultModel: 'gemini-2.5-pro'
}
```

Then, generate a spec:

```bash
npx @mmnto/cli spec 123
```

_(Totem will fetch Issue #123, assemble the relevant context, and invoke your orchestrator to print the briefing)._

## Strategic Roadmap

Totem is actively evolving from a memory database into a full Shift-Left orchestrator.

- [x] **Pillar 1: The Memory Layer** - Local vector DB, syntax-aware chunking, and MCP interface.
- [x] **Pillar 2: The Reflex Engine** - Auto-injection of AI prompts, proactive learning triggers, and background git hooks. (See [Epic #19](https://github.com/mmnto-ai/totem/issues/19))
- [ ] **Pillar 3: The Workflow Orchestrator** - Native CLI commands (`totem spec`, `totem shield`) for pre-work briefings and local PR reviews. (See [Epic #20](https://github.com/mmnto-ai/totem/issues/20))
- [ ] **Pillar 4: Polish** - Automated memory consolidation and CLI UI/UX polish.

For a deeper dive into the system design, see `docs/architecture.md`.

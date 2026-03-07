# Totem

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. We are actively working on improving the "Magic Onboarding" experience (UX polish, seamless host integration) and stabilizing support for different ingestion setups and platform variations (Windows/macOS). If you encounter friction during `totem init`, please bear with us as we polish these workflows!

**Your AI team forgets. Totem remembers.**

Right now, AI development is where code versioning was before Git. Every time you open a new AI session, your agents have amnesia. They forget why you chose Drizzle over Prisma, they hallucinate deprecated database tables, and they fall into the same architectural traps you fixed last week.

**Totem is the state manager for your AI's brain.**

It is an **AI Control Plane for Local Development**. Instead of uploading your proprietary codebase to a cloud SaaS platform, Totem compiles a syntax-aware, embedded vector index (LanceDB) right inside your project. It acts as an **Architectural Linter**, using the standard Model Context Protocol (MCP) to force your local agents (Claude, Gemini, Cursor) to read your project's constraints, decisions, and trap-logs _before_ they write a single line of code.

When you're three levels deep in a debugging session, you need to know if the code you are writing is real, or just an AI hallucinating an anti-pattern you banned three months ago. You need a totem.

## Why Totem?

- **Local-First & Git-Native:** Memory shouldn't be locked in a cloud SaaS. Totem compiles an embedded LanceDB vector index right inside your project (`.lancedb/`). The actual knowledge is stored in a human-readable, version-controlled `.totem/lessons.md` file. Review your AI's memory in your PRs.
- **The Reflex Engine:** Totem doesn't just give your AI a database; it gives them _reflexes_. `totem init` auto-injects behavioral triggers into your AI's system prompts (`CLAUDE.md`, `.cursorrules`), forcing them to autonomously document traps and query architecture before they write code.
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" and workflow orchestrator (via `totem spec`) for your entire AI org chart.
- **Built for Enterprise Scale:** The ingestion pipeline streams chunks in batches directly to the local vector store, maintaining a flat memory footprint regardless of how massive your monorepo gets.

## Philosophy: The Unix Approach to AI

The tech industry is currently trying to build massive, monolithic "AI Developer Platforms" — web apps where you type a prompt and a black-box swarm of cloud agents writes the code for you.

Developers hate black boxes.

Totem applies the **Unix Philosophy** to AI orchestration. We believe AI models are just standard IO processes. You don't need a heavy web UI to orchestrate them; you just need a CLI.

By building our orchestrator as discrete, composable commands (`spec`, `shield`, `triage`), we keep the developer in the terminal. You define the "Traction Points." If an AI generates a bad plan, you can run `totem spec --raw` to debug the context, edit the markdown, and fix it yourself. We don't replace your editor; we provide the invisible, configurable plumbing that connects your local agents together.

## Architecture

This is a Turborepo monorepo consisting of:

- **`@mmnto/totem`**: The core chunking logic (AST, Markdown headings, Session logs) and LanceDB interface.
- **`@mmnto/cli`**: The executable interface (`totem init`, `totem sync`).
- **`@mmnto/mcp`**: The standard I/O Model Context Protocol (MCP) server that exposes the `search_knowledge` and `add_lesson` tools to your AI.

## Security & Privacy

- **100% Local Privacy:** Totem's vector database (`.lancedb/`) lives entirely within your local repository. Your codebase is never uploaded to a centralized SaaS platform or external memory service.
- **Injection Hardening:** Totem actively sanitizes untrusted inputs (like PR comments fetched during `totem learn` and external GitHub issues) before persisting them and before writing to terminal output streams. This prevents indirect prompt injection and terminal injection attacks.

## Getting Started

### 1. Initialize Totem

Run this inside your consuming project (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This will auto-detect your project structure, generate a `totem.config.ts`, install automated background git hooks, and inject the Proactive Memory Reflexes into your AI's system prompt.

**Seamless Host Integration:** If you are using Claude Code or Gemini CLI, `totem init` will automatically wire up agent hooks to run `totem briefing` at the start of your session and intercept `git commit`/`push` to run `totem shield` automatically.

### 2. Configure your Embedding Provider

Totem defaults to OpenAI's `text-embedding-3-small` for a zero-friction start. You can configure this, or switch to a local Ollama model (`nomic-embed-text`), in `totem.config.ts`. Ensure your `.env` contains an `OPENAI_API_KEY` if using the default.

> [!TIP]
> **OpenAI Rate Limits:**
> Totem uses exponential backoff to handle transient API rate limits, but if you have a massive codebase and run into strict, persistent OpenAI quota limits during your very first full index, we recommend switching your provider to the local `Ollama` fallback for the initial sync.

### 3. Sync the Index

```bash
npx @mmnto/cli sync
```

_(Note: If you accepted the git hook installation during `init`, Totem will automatically run incremental background syncs after every `git pull` or `git merge`)._

> [!TIP]
> **Troubleshooting Index Issues:**
> Anytime you manually delete the `.lancedb` folder, always run `pnpm exec totem sync --full` (or just `totem sync --full` if you add it to your `package.json` scripts). The `--full` flag skips the incremental deletion logic entirely, dropping the old index and recreating it from scratch, completely avoiding the buggy DELETE query.

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

### 5. The Workflow Orchestrator

> [!NOTE]
> **Prerequisite:** Currently, all orchestrator commands that fetch remote issue or PR data (like `spec`, `triage`, and `learn`) require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed and authenticated on your machine. Adapters for Jira, Linear, and others are on the roadmap.

Totem ships with native CLI commands that orchestrate your entire shift-left workflow by querying LanceDB and invoking your AI to make project-aware decisions.

First, configure your orchestrator in `totem.config.ts`:

```typescript
// Use the Gemini CLI as your orchestrator
orchestrator: {
  provider: 'shell',
  command: 'gemini --model {model} --prompt "{file}"',
  defaultModel: 'gemini-3-flash-preview',
  fallbackModel: 'gemini-2.5-flash', // Used automatically on quota/rate-limit errors
  overrides: {
    spec: 'gemini-3.1-pro-preview',
    shield: 'gemini-3.1-pro-preview',
    triage: 'gemini-3.1-pro-preview'
  },
  cacheTtls: {
    triage: 3600, // Cache results for 1 hour
    briefing: 1800 // Cache results for 30 minutes
  }
}
```

Then, run the workflow commands (pass `--fresh` to bypass caching and force a fresh LLM call):

**Session Briefings (`briefing`)**

```bash
npx @mmnto/cli briefing
```

_(Totem fetches your current git branch, uncommitted changes, open PRs, and recent session momentum to generate a startup briefing for your AI)._

**Mid-Session Context Reset (`bridge`)**

```bash
npx @mmnto/cli bridge
```

_(Totem assesses your current mid-task state and creates a lightweight breadcrumb file. Use this when your AI agent's context window gets too full and you need to clear the chat without losing your place)._

**Pre-Work Briefings (`spec`)**

```bash
npx @mmnto/cli spec 123 124 https://github.com/org/repo/issues/125
```

_(Totem fetches multiple GitHub Issues, retrieves relevant architectural context, and synthesizes a pre-work spec. The AI strictly adopts the persona of a **Staff-Level Architect**, refusing to write code and instead focusing on data contracts, edge cases, and technical planning)._

**Pre-Flight Reviews (`shield`)**

```bash
npx @mmnto/cli shield
```

_(Totem reads your uncommitted git diff, queries LanceDB for related traps, and performs an architectural code review before you push. The AI adopts a ruthless **Red Team Reality Checker** persona, demanding evidence of tests and explicitly looking for reasons the code will fail)._

**Post-Merge Roadmap (`triage`)**

```bash
npx @mmnto/cli triage --out docs/active_work.md
```

_(Totem fetches your open GitHub issues, reads recent session momentum, and generates a prioritized roadmap for your next task. The AI strictly acts as a **Product Manager**, setting scope boundaries and prioritizing work based on momentum)._

**Proactive Anchoring (`anchor` / `add-lesson`)**

```bash
npx @mmnto/cli anchor
```

_(Totem interactively prompts you to document a context, symptom, and fix/rule. It saves the lesson to `.totem/lessons.md` and automatically triggers a background re-index so the new knowledge is instantly available to your AI agents)._

**End-of-Task Automation (`wrap`)**

```bash
npx @mmnto/cli wrap
```

_(Totem sequentially runs the `learn` extraction loop on your recent changes, syncs the vector database, and generates an end-of-session `handoff` briefing in one command)._

**PR Learning Loop (`learn`)**

```bash
npx @mmnto/cli learn 101 102
```

_(Totem fetches one or more recently merged PRs, reads the review comments, and extracts systemic architectural traps or rules. It interactively asks you to confirm the extracted rules before appending them to your project's memory)._

**End of Session (`handoff`)**

```bash
npx @mmnto/cli handoff --out session-handoff.md
```

_(Totem captures your uncommitted git changes and any lessons learned today, synthesizing a tactical snapshot so your next session doesn't start cold)._

**Clean Ejection (`eject`)**

```bash
npx @mmnto/cli eject
```

_(Safely removes all Totem git hooks, generated configuration files, AI agent prompt injections, and the local `.lancedb/` vector index, cleanly uninstalling Totem from your repository)._

> [!TIP]
> **Custom Prompt Overrides**
> By default, the orchestrator uses highly opinionated personas (like the "Red Team Architect" in `shield`). If you want to customize these, simply create a markdown file in `.totem/prompts/<command>.md` (e.g., `.totem/prompts/shield.md`). Totem will automatically detect your file and use your custom rules instead of the built-in system prompt.

## Strategic Roadmap

Totem is actively evolving from a memory database into a full Shift-Left orchestrator.

- [x] **Pillar 1: The Memory Layer** - Local vector DB, syntax-aware chunking, and MCP interface.
- [x] **Pillar 2: The Reflex Engine** - Auto-injection of AI prompts, proactive learning triggers, and background git hooks. (See [Epic #19](https://github.com/mmnto-ai/totem/issues/19))
- [x] **Pillar 3: The Workflow Orchestrator** - Native CLI commands (`totem spec`, `totem shield`, `totem triage`) for pre-work briefings and local PR reviews. (See [Epic #20](https://github.com/mmnto-ai/totem/issues/20))
- [ ] **Pillar 4: Polish** - Automated memory consolidation, comprehensive test coverage, robust GitHub API handling, and CLI UI/UX polish.

For a deeper dive into the system design, see `docs/architecture.md`.

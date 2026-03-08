# Totem

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. While Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete—including our move to **Tree-sitter for Universal AST Parsing** (#173)—we are still polishing the "Magic Onboarding" experience (interactive tutorials, seamless host integration) and validating the core OpenAI embedding pipeline. If you encounter friction during `totem init`, please bear with us!

**Your AI team forgets. Totem remembers.**

Right now, AI development is where code versioning was before Git. Every time you open a new AI session, your agents have amnesia. They forget why you chose Drizzle over Prisma, they hallucinate deprecated database tables, and they fall into the same architectural traps you fixed last week.

**Totem is the state manager for your AI's brain.**

It is an **AI Control Plane for Local Development**. Instead of uploading your proprietary codebase to a cloud SaaS platform, Totem compiles a syntax-aware, embedded vector index (LanceDB) right inside your project. It acts as an **Architectural Linter**, using the standard Model Context Protocol (MCP) to force your local agents (Claude, Gemini, Cursor) to read your project's constraints, decisions, and trap-logs _before_ they write a single line of code.

When you're three levels deep in a debugging session, you need to know if the code you are writing is real, or just an AI hallucinating an anti-pattern you banned three months ago. You need a totem.

## Why Totem?

- **Local-First & Git-Native:** Memory shouldn't be locked in a cloud SaaS. Totem compiles an embedded LanceDB vector index right inside your project (`.lancedb/`). The actual knowledge is stored in a human-readable, version-controlled `.totem/lessons.md` file. Review your AI's memory in your PRs.
- **The Reflex Engine:** Totem doesn't just give your AI a database; it gives them _reflexes_. `totem init` auto-injects behavioral triggers and **Defensive Context Management Reflexes** (#160) into your AI's system prompts (`CLAUDE.md`, `.cursorrules`), forcing them to autonomously document traps, query architecture, and issue warnings before they write code.
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" and workflow orchestrator (via `totem spec`) for your entire AI org chart.
- **Built for Enterprise Scale:** The ingestion pipeline streams chunks in batches directly to the local vector store (#104), maintaining a flat memory footprint regardless of how massive your monorepo gets. Features like **Drift Detection** (#177) ensure your memory stays self-cleaning and relevant as the codebase evolves.

## Philosophy: The Unix Approach to AI

The tech industry is currently trying to build massive, monolithic "AI Developer Platforms" — web apps where you type a prompt and a black-box swarm of cloud agents writes the code for you.

Developers hate black boxes.

Totem applies the **Unix Philosophy** to AI orchestration. We believe AI models are just standard IO processes. You don't need a heavy web UI to orchestrate them; you just need a CLI.

By building our orchestrator as discrete, composable commands (`spec`, `shield`, `triage`, `docs`), we keep the developer in the terminal. You define the "Traction Points." If an AI generates a bad plan, you can run `totem spec --raw` to debug the context, edit the markdown, and fix it yourself. We don't replace your editor; we provide the invisible, configurable plumbing that connects your local agents together.

## Architecture

This is a Turborepo monorepo consisting of:

- **`@mmnto/totem`**: The core logic using **Tree-sitter for Universal AST Parsing**, syntax-aware chunking (with heading hierarchy breadcrumbs), and the LanceDB interface.
- **`@mmnto/cli`**: The executable interface (`totem init`, `totem sync`).
- **`@mmnto/mcp`**: The standard I/O Model Context Protocol (MCP) server that exposes the `search_knowledge` and `add_lesson` tools to your AI.

## Security & Privacy

- **100% Local Privacy:** Totem's vector database (`.lancedb/`) lives entirely within your local repository. Your codebase is never uploaded to a centralized SaaS platform or external memory service.
- **Injection Hardening:** Totem actively sanitizes untrusted inputs (like PR comments fetched during `totem extract` and external GitHub issues) and **XML-delimits MCP responses** (#149) to mitigate indirect prompt injection and terminal injection attacks.

## Getting Started

### 1. Initialize Totem

Run this inside your consuming project (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This will auto-detect your project structure, generate a `totem.config.ts` using **Minimum Viable Configuration (MVC) tiers** (#187), install automated background git hooks, and inject the Proactive Memory Reflexes into your AI's system prompt.

**Universal Baseline:** During init, Totem offers to install a curated set of foundational AI developer lessons (#128) (prompt injection prevention, hallucination traps, dependency verification, etc.) so your agents have useful knowledge from Day 1.

**Seamless Host Integration:** If you are using Claude Code or Gemini CLI, `totem init` will automatically wire up agent hooks (including native `SessionStart` hooks #95) to run `totem briefing` and intercept `git commit`/`push` to run `totem shield` automatically.

### 2. Configure your Embedding Provider

Totem auto-detects your environment during `totem init` and picks the best configuration tier:

| Tier         | What you need                                | What you get                                    |
| ------------ | -------------------------------------------- | ----------------------------------------------- |
| **Lite**     | Nothing (zero API keys)                      | Lesson capture, bridge, eject                   |
| **Standard** | `OPENAI_API_KEY` in `.env` (or Ollama)       | Lite + sync, search, stats                      |
| **Full**     | Standard + an orchestrator (e.g. Gemini CLI) | All commands (spec, shield, triage, docs, etc.) |

If `OPENAI_API_KEY` is already set in your environment or `.env`, `totem init` will detect it automatically. Totem uses exponential backoff (#105) to handle API rate limits. You can always upgrade from Lite by setting your key and re-running `totem init`.

### 3. Sync the Index

```bash
npx @mmnto/cli sync
```

_(Note: If you accepted the git hook installation during `init`, Totem will automatically run incremental background syncs after every `git pull` or `git merge`)._

> [!TIP]
> **Troubleshooting Index Issues:**
> Anytime you manually delete the `.lancedb` folder, always run `pnpm exec totem sync --full`. The `--full` flag drops the old index and recreates it from scratch, avoiding potential LanceDB case-sensitivity or parsing edge cases during deletions.

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
> **Prerequisite:** Currently, all orchestrator commands that fetch remote data (like `spec`, `triage`, and `extract`) require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed. Adapters for other platforms are on the roadmap.

Totem ships with native CLI commands that orchestrate your entire shift-left workflow by querying LanceDB and invoking your AI to make project-aware decisions.

First, configure your orchestrator in `totem.config.ts`:

```typescript
// Use the Gemini CLI as your orchestrator
orchestrator: {
  provider: 'shell',
  command: 'gemini --model {model} --prompt "{file}"',
  defaultModel: 'gemini-3-flash-preview',
  fallbackModel: 'gemini-2.5-flash',
  overrides: {
    spec: 'gemini-3.1-pro-preview',
    shield: 'gemini-3.1-pro-preview',
    triage: 'gemini-3.1-pro-preview'
  }
}
```

**Workflow Commands:**

- **`briefing`**: Fetches your current git branch, uncommitted changes, open PRs, and recent session momentum to generate a startup briefing.
- **`bridge`**: Assesses your current mid-task state and creates a lightweight breadcrumb file. Use this when your AI agent's context window gets too full.
- **`spec <ids...>`**: Fetches GitHub Issues (supports URLs) and synthesizes a pre-work spec. The AI acts as a **Staff-Level Architect**, focusing on contracts and edge cases.
- **`shield`**: Reads your uncommitted git diff, queries LanceDB for related traps, and performs a **hybrid zero-day + N-day architectural code review** (#98) before you push.
- **`triage`**: Fetches open GitHub issues and generates a prioritized roadmap (e.g., `docs/active_work.md`) for your next task.
- **`add-lesson`**: Interactively document a context, symptom, and fix. Saves to `.totem/lessons.md` and triggers a background re-index.
- **`docs`**: Automatically syncs project documentation (README, Roadmap) by analyzing git logs and closed issues since the last release (#190).
- **`wrap`**: A post-merge workflow chain that runs `extract`, syncs the database, generates a roadmap, and updates docs in one command (#143).
- **`extract <ids...>`**: Fetches merged PRs, reads comments, and extracts systemic architectural traps with **descriptive headings** (#203). Supports interactive multi-select pruning.
- **`handoff`**: Captures uncommitted changes and lessons learned today, synthesizing a tactical snapshot for your next session.
- **`eject`**: Safely removes all Totem git hooks, configuration files, AI agent prompt injections, and the local `.lancedb/` index (#131).

> [!TIP]
> **Custom Prompt Overrides**
> Customize any command by creating a markdown file in `.totem/prompts/<command>.md` (e.g., `.totem/prompts/shield.md`) (#120).

### 6. Shield GitHub Action (CI/CD)

Enforce Totem's quality gate automatically on every pull request (#180). The action syncs the index and runs `totem shield` — if a violation is detected, the workflow fails with the full report.

```yaml
# .github/workflows/shield.yml
name: Totem Shield
on:
  pull_request:
    branches: [main]

jobs:
  shield:
    runs-runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: mmnto-ai/totem@main
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Strategic Roadmap

Totem is evolving from a memory database into a full Shift-Left orchestrator.

- [x] **Pillar 1: The Memory Layer** - Local vector DB, tree-sitter syntax-aware chunking, and MCP interface.
- [x] **Pillar 2: The Reflex Engine** - Auto-injection of AI prompts, proactive learning triggers, and background git hooks.
- [x] **Pillar 3: The Workflow Orchestrator** - Native CLI commands (`spec`, `shield`, `triage`, `docs`, `wrap`) for pre-work briefings and local PR reviews.
- [ ] **Pillar 4: Polish** - OpenAI embedding validation (#4), interactive tutorials (#129), cross-platform stability (Windows/macOS), and automated memory consolidation.

For a deeper dive into the system design, see `docs/architecture.md`.

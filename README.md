# Totem

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. While Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, we are still polishing the "Magic Onboarding" experience (interactive tutorials). If you encounter friction during `totem init`, please bear with us!

## Your AI team forgets. Totem remembers.

**AI generates the code. You generate the rules.**
Totem is the local-first governance compiler for AI agents — **deterministic, git-native, and trustworthy.**

## Why Totem?

- **Local-First & Git-Native:** Totem compiles an embedded LanceDB vector index directly inside your project, storing actual knowledge in a human-readable, version-controlled `.totem/lessons/` directory. Review your AI's memory locally in your PRs instead of locking it in a cloud SaaS.
- **The Reflex Engine:** Totem gives your AI reflexes by auto-injecting behavioral triggers and Defensive Context Management Reflexes into system prompts. This forces them to autonomously document traps, query architecture, and issue warnings before writing code.
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" orchestrator, supporting role-based access control (RBAC) across your entire AI org chart.
- **Built for Enterprise Scale:** The ingestion pipeline streams chunks in batches, maintaining a flat memory footprint regardless of monorepo size. Drift Detection ensures your memory stays self-cleaning and relevant as the codebase evolves.

## Philosophy: The Unix Approach to AI

The tech industry is currently trying to build massive, monolithic "AI Developer Platforms" — web apps where you type a prompt and a black-box swarm of cloud agents writes the code for you.

Developers hate black boxes.

Totem applies the **Unix Philosophy** to AI orchestration. We believe AI models are just standard IO processes. You don't need a heavy web UI to orchestrate them; you just need a CLI.

By building our orchestrator as discrete, composable commands (`spec`, `shield`, `triage`, `docs`), we keep the developer in the terminal. You define the "Traction Points." If an AI generates a bad plan, you can run `totem spec --raw` to debug the context, edit the markdown, and fix it yourself. We don't replace your editor; we provide the invisible, configurable plumbing that connects your local agents together.

## Security & Privacy: The Air-Gapped Doctrine

Totem is architected for high-compliance enterprise sectors (defense, finance, healthcare) that operate in strict AI sandboxes. **We adhere to the Air-Gapped Doctrine (Zero-Telemetry Architecture).**

- **Zero Default Telemetry:** The `totem` CLI will *never* transmit usage statistics, codebase contents, error logs, or rule evaluation metrics to a centralized server. Your codebase stays on your machine.
- **Pluggable Local Intelligence:** Every command that requires an AI model (`totem sync`, `totem shield`) natively supports local execution via Ollama or private VPC endpoints. You can run the entire Codebase Immune System without a public internet connection.
- **Bounded MCP Boundaries:** The Totem MCP server is a strict read-only/append-only context provider. It will *never* expose destructive filesystem tools (e.g., `execute_command`, `delete_file`) to connected AI agents. This neutralizes the risk of agents executing malicious code via indirect prompt injection (e.g., if an agent reads a poisoned `README.md` from an npm package).
- **Injection & ReDoS Hardening:** Totem actively sanitizes untrusted inputs and neutralizes terminal injection attacks (ANSI escapes in Git outputs). We apply SECURITY NOTICES to PR comments during extraction to explicitly warn agents of untrusted text.

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org/) (or use a version manager like `nvm`/`fnm`)
- **pnpm** _(recommended)_ — `corepack enable` or see other methods at [pnpm.io/installation](https://pnpm.io/installation)
- **GitHub CLI (`gh`)** _(optional, for orchestrator commands)_ — [cli.github.com](https://cli.github.com/)

Totem works on **Windows**, **macOS**, and **Linux**.

## Getting Started: The 10-Minute Quickstart

### 1. Initialize Totem

Run this inside your consuming project (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This will auto-detect your project structure and package manager. It generates a `totem.config.ts`, creates a `.totemignore` file, and injects **Proactive Memory Reflexes** into your AI agent's instruction files (like `CLAUDE.md`). It also installs a Curated Universal Baseline of AI traps to get you started on Day 1.

### 2. Configure your Embedding Provider

If `OPENAI_API_KEY` is already set in your environment or `.env`, `totem init` will detect it automatically. If you want to use local models (like Ollama) or cross-provider routing (Anthropic/Gemini), check out the [Advanced Configuration Wiki](./docs/wiki/advanced-configuration.md).

### 3. Sync the Index

```bash
npx @mmnto/cli sync
```
This builds your local LanceDB vector index. *(Note: If you accepted the git hook installation during `init`, Totem will automatically run incremental background syncs after every `git pull` or `git merge`).*

### 4. Connect the MCP Server

Add Totem to your AI agent's configuration (e.g., Claude Desktop, Claude Code, Gemini, Cursor). This equips the agent with standard retrieval tools alongside robust enforcement hooks like `get_rules_for_file`.

**macOS / Linux:**
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

**Windows:**
```json
{
  "mcpServers": {
    "totem": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@mmnto/mcp"]
    }
  }
}
```
*Note: For more details on IDE-specific wiring (like JetBrains Junie) or pinning MCP versions, see the [Advanced Configuration Wiki](./docs/wiki/advanced-configuration.md).*

### 5. The Codebase Immune System

Once your index is built, Totem natively intercepts your git pushes to perform an architectural review.

**`totem shield`**
Reads your uncommitted diff and queries LanceDB for related traps to perform a deterministic architectural code review.
- Executes in milliseconds using compiled rules.
- To integrate this into your CI/CD pipeline with SARIF support, see the [CI Integration Wiki](./docs/wiki/ci-integration.md).

## Core Command Index

Totem ships with native CLI commands that orchestrate your entire shift-left workflow. 

- **Discovery:** `briefing`, `triage`, `audit`
- **Architectural Control:** `spec`, `shield`, `test`
- **Memory Management:** `extract`, `compile`, `add-lesson`, `docs`
- **Workflow:** `wrap`, `handoff`, `bridge`

For an exhaustive breakdown of every command and its flags, read the [CLI Reference Wiki](./docs/wiki/cli-reference.md).

---

## Strategic Roadmap

To see where Totem is heading, including Phase 3 (The DX & Reliability Engine) and the vision for Federated Memory, view our [Strategic Roadmap](./docs/wiki/roadmap.md). For deeper architectural dives, see `docs/architecture.md`.

## Contributing

We welcome community contributions! Please review our `CONTRIBUTING.md` guidelines. Note that all external contributions require signing our automated Contributor License Agreement (CLA), and internal strategy discussions are isolated in the `totem-strategy` submodule.

## License

Licensed under the Apache 2.0 License.

# Totem

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. While Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, we are still polishing the "Magic Onboarding" experience (interactive tutorials). If you encounter friction during `totem init`, please bear with us!

## Your AI team forgets. Totem remembers.

**AI generates the code. You generate the rules.**
Totem is the local-first governance compiler for AI agents — **deterministic, git-native, and trustworthy.**

## Why Totem?

- **Local-First & Git-Native:** Totem compiles an embedded LanceDB hybrid search (FTS + vector) index directly inside your project (#378). Review your AI's memory locally in your PRs instead of locking it in a cloud SaaS.
- **The Reflex Engine:** Totem gives your AI reflexes by auto-injecting behavioral triggers and Defensive Context Management Reflexes into system prompts. This forces them to autonomously document traps, query architecture, and issue warnings before writing code.
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" orchestrator, supporting role-based access control (RBAC) across your entire AI org chart.
- **Built for Enterprise Scale:**
  - **Performance:** Ingestion streams chunks in batches for a flat memory footprint.
  - **Relevance:** Drift Detection keeps memory self-cleaning as code evolves.
  - **Reliability:** Startup health checks automatically detect broken LanceStore indexes (#439). The system features graceful degradation, automatically falling back to local models or CLI orchestrators if cloud providers fail (#516, #517, #522).

## Philosophy: The Unix Approach to AI

The tech industry is currently trying to build massive, monolithic "AI Developer Platforms" — web apps where you type a prompt and a black-box swarm of cloud agents writes the code for you.

Developers hate black boxes.

Totem applies the **Unix Philosophy** to AI orchestration. We believe AI models are just standard IO processes. You don't need a heavy web UI to orchestrate them; you just need a CLI.

By building our orchestrator as discrete, composable commands (`spec`, `shield`, `lint`, `triage`, `docs`), we keep the developer in the terminal. You define the "Traction Points." If an AI generates a bad plan, you can run `totem spec --raw` to debug the context, edit the markdown, and fix it yourself. We don't replace your editor; we provide the invisible, configurable plumbing that connects your local agents together.

## Security & Privacy: The Air-Gapped Doctrine

Totem is architected for high-compliance enterprise sectors (defense, finance, healthcare) that operate in strict AI sandboxes. **We adhere to the Air-Gapped Doctrine (Zero-Telemetry Architecture).**

- **Zero Default Telemetry:** The `totem` CLI will _never_ transmit usage statistics, codebase contents, error logs, or rule evaluation metrics to a centralized server. Your codebase stays on your machine.
- **Pluggable Local Intelligence:** Every command that requires an AI model natively supports local execution via Ollama or private VPC endpoints. Orchestrators and embedders gracefully degrade to local CLI/Ollama fallbacks if SDKs or networks fail (#516, #517).
- **Bounded MCP Boundaries:** The Totem MCP server is a strict context provider that will _never_ expose destructive filesystem tools. This neutralizes the risk of agents executing malicious code via indirect prompt injection.
- **Injection & ReDoS Hardening:** Totem actively sanitizes untrusted inputs and neutralizes terminal injection attacks. We apply SECURITY NOTICES to PR comments during extraction to explicitly warn agents of untrusted text.

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

Auto-detects your environment (including Copilot and Junie) to generate a `totem.config.ts` (#448). It injects Proactive Memory Reflexes into your AI instruction files using a recency sandwich approach for optimal context retention (#511). It also installs a Curated Universal Baseline of AI traps to get you started on Day 1 (#419).

### 2. Configure your Embedding Provider

If API keys are already set in your environment or `.env`, `totem init` will detect them automatically. The baseline configuration defaults to `gemini-embedding-2-preview` for highly optimized semantic retrieval (#539). If you want to use local models or alternative cross-provider routing, check out the [Advanced Configuration Wiki](./docs/wiki/advanced-configuration.md).

### 3. Sync the Index

```bash
npx @mmnto/cli sync
```

This builds your local LanceDB vector index. _(Note: If you accepted the git hook installation during `init`, Totem will automatically run incremental background syncs after every `git pull` or `git merge`)._

### 4. Connect the MCP Server

Add Totem to your AI agent's configuration to equip it with `search_knowledge`, `add_lesson`, and MCP enforcement tools like `check_compliance` for self-correction (#417). Zombie process harvesting ensures the MCP server cleans up gracefully on timeouts (#503). Supported environments include:

- **Standalone:** Claude Desktop, Claude Code
- **IDE Integrations:** Cursor, Copilot, JetBrains Junie (#448)
- **Web Orchestrators:** Gemini

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

_Note: For more details on IDE-specific wiring or pinning MCP versions, see the [Advanced Configuration Wiki](./docs/wiki/advanced-configuration.md)._

### 5. The Codebase Immune System

Once your index is built, Totem natively intercepts your git pushes to perform an architectural review.

**`totem shield`**
Reads your uncommitted diff and queries LanceDB for related traps to perform a deterministic architectural code review.

- Executes in milliseconds using compiled rules scoped precisely to modified file boundaries (#546).
- Outputs SARIF 2.1.0 natively for seamless CI/CD and GitHub Advanced Security integration (#387, #418).

**`totem lint`**
A discrete stylistic governance check split from the core `shield` command (#549). Allows you to validate syntactic rules independently of deep architectural validations.

## Core Command Index

Totem ships with native CLI commands that orchestrate your entire shift-left workflow.

- **Discovery:**
  - **Analysis:** `briefing`, `audit`, `stats` (semantic rule observability) (#545)
  - **Prioritization:** `triage` (supports configurable multi-repo issue sources) (#514, #532)
- **Architectural Control:**
  - **Validation:** `shield`, `lint` (#549), `test` (compiled rule harness) (#422)
  - **Enforcement:** `spec`, `hooks` (#310)
- **Memory Management:**
  - **Extraction:** `extract` (supports multi-repo inputs), `add-lesson` (#532)
  - **Processing:** `compile`, `docs`
- **Workflow:**
  - **Transitions:** `handoff`, `bridge`
  - **Execution:** `wrap`

For an exhaustive breakdown of every command and its flags, read the [CLI Reference Wiki](./docs/wiki/cli-reference.md).

---

## Strategic Roadmap

To see where Totem is heading, including Phase 3 (The DX & Reliability Engine) and the vision for Federated Memory, view our [Strategic Roadmap](./docs/wiki/roadmap.md). For deeper architectural dives, see `docs/architecture.md`.

## Contributing

We welcome community contributions! You can explore our `totem-studio` playground repository to test consumer integrations in a safe environment (#481). Please review our `CONTRIBUTING.md` guidelines and the Dev Onboarding Wiki (#449) for testing conventions (#452). Note that external contributions require signing our automated Contributor License Agreement (CLA), and internal strategy discussions are isolated in the `totem-strategy` submodule.

## License

Licensed under the Apache 2.0 License.

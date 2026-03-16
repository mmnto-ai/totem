# Totem

**Prove your AI-assisted code is safe. Ship faster.**

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. While Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, we are actively refining the onboarding experience. If you encounter friction during `totem init`, please bear with us!

You write `.cursorrules` in plain English. AI agents ignore them.

Totem is a Governance Compiler. It ingests your natural language rules and compiles them into lightning-fast, deterministic AST/Regex guardrails that block bad code _before_ it commits.

You get the ease of AI prompting with the zero-latency, zero-hallucination guarantee of Semgrep.

## The 10-Second Workflow

Write code with your AI. Then, let Totem prove it's safe.

1. **Verify:** Run `npx @mmnto/cli lint` (or let the git hook do it automatically). Zero LLM, ~2 seconds.
2. **Pass:** `✓ PASS — 137 rules, 0 violations.` Push with confidence.
3. **Prove:** Run `npx @mmnto/cli stats` to see your ROI.
   `> Total violations prevented: 47 | security: 12, architecture: 35`

## Quickstart

### 1. Initialize Totem

Run this inside your project root (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This auto-detects your environment (Cursor, Copilot, Junie) and sets up your `totem.config.ts`.

### 2. Sync the Index

```bash
npx @mmnto/cli sync
```

This builds your local vector index from your codebase, docs, and lessons.

### 3. Connect the MCP Server

Add Totem to your AI agent's configuration. This gives your agent the ability to search project knowledge (`search_knowledge`) and document new architectural traps (`add_lesson`) without leaving the editor.

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

## What Totem Actually Does

We are not an AI code reviewer that gives you subjective "readability" suggestions in your Pull Requests.

We are a compiler that enforces **Invariants**—business logic that must _never_ happen.

- **Instruction Verifier:** We don't replace your `.mdc` or `.cursorrules` files. We enforce them. You wrote the prompt; we ensure the agent didn't ignore it.
- **Deterministic Enforcement:** `totem lint` uses Tree-sitter to parse your AST. It does not use an LLM. It does not hallucinate. It is a mathematical check against your compiled rules.
- **Continuous Learning:** When you catch a bug in a PR, run `totem extract`. Totem learns the lesson and compiles a new invariant so that specific bug can never be merged again.

## Enterprise Grade (The Compliance Ledger)

Totem is architected for high-compliance enterprise sectors (defense, finance, healthcare).

- **Air-Gapped Execution:** The core enforcement engine (`totem lint`) requires zero API keys. It runs entirely locally. Your proprietary codebase never leaves your machine.
- **SARIF Integration:** Totem outputs standard Static Analysis Results Interchange Format (SARIF 2.1.0). This means your Trap Ledger integrates seamlessly into GitHub Advanced Security, GitLab Ultimate, and SonarQube dashboards to prove SOC 2 / DORA compliance to your auditors.

## Works With Your Existing Tools

Totem is the invisible plumbing that connects your local agents together. We natively support:

- **Editors:** Cursor, Windsurf, GitHub Copilot, JetBrains Junie
- **Agents:** Claude Code, Gemini CLI, Aider
- **Orchestrators:** Anthropic, Google GenAI, OpenAI, Ollama (Local)

---

## Core Command Index

- **Validation:** `lint` (Deterministic AST checks), `shield` (AI-assisted architectural review)
- **Reporting:** `stats` (The Trap Ledger), `audit`, `briefing`
- **Memory Management:** `extract` (Learn from PRs), `compile` (Ingest `.mdc` files), `sync`

For an exhaustive breakdown of every command and its flags, read the [CLI Reference Wiki](./docs/wiki/cli-reference.md).

## Strategic Roadmap & Contributing

To see where Totem is heading, view our [Strategic Roadmap](./docs/wiki/roadmap.md). For deeper architectural dives, see `docs/architecture.md`.

We welcome community contributions! Please review our `CONTRIBUTING.md` guidelines and the Dev Onboarding Wiki.

## License

Licensed under the Apache 2.0 License.

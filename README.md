# Totem

**Git for AI. Rule your context.**

A zero-config CLI that compiles your `.cursorrules` into deterministic CI guardrails. Stop repeating yourself to your AI.

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is in early alpha. Foundations through Phase 3 are functionally complete. If you hit friction during `totem init`, bear with us!

Totem is not a framework. It's not a library. It's a **drop-in CLI and MCP Server** that gives leading AI agents (Cursor, Copilot, Claude Code) deterministic guardrails — in 60 seconds.

You write `.cursorrules` in plain English. AI agents ignore them. Totem compiles those rules into mathematical AST/Regex checks that block bad code before it commits. Zero LLM. Zero hallucination. ~2 seconds.

## The 10-Second Workflow

```bash
$ npx @mmnto/cli lint
✓ PASS — 137 rules, 0 violations.

$ npx @mmnto/cli stats
Total violations prevented: 47 | security: 12, architecture: 35
```

Write code with your AI. Run `totem lint`. Push with confidence. Run `totem stats` to prove your ROI.

## Quickstart

### 1. Initialize

```bash
npx @mmnto/cli init
```

Auto-detects your environment (Cursor, Copilot, Junie) and sets up `totem.config.ts`. Ships with **60 battle-tested lessons** extracted from PR reviews across major ecosystem tools:

- **Frameworks:** Next.js, React.
- **Data Layer:** Prisma, Drizzle.
- **Styling:** Tailwind.

Your project gets immediate protection against the most common architectural traps on Day 1. Already have `.cursorrules` or `.mdc` files? `totem init` auto-ingests them and compiles your instructions into deterministic rules.

### 2. Connect the MCP Server

Give your AI agent persistent project memory. `search_knowledge` retrieves traps, patterns, and architectural constraints, while `add_lesson` captures new ones.

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

Works with any MCP-compatible agent, including:

- **Desktop Apps:** Claude Desktop.
- **Editors:** Cursor, Windsurf.
- **CLIs:** Claude Code, Gemini CLI.

### 3. Sync & Lint

```bash
npx @mmnto/cli sync    # Build the vector index
npx @mmnto/cli lint    # Run compiled rules (zero LLM)
```

That's it. Your pre-push hook runs `totem lint` automatically.

## What Totem Actually Is

**We don't compile your code. We compile your rules.**

Your `.cursorrules` and `.mdc` files are plain English. Totem reads them and generates deterministic AST/Regex queries — the same enforcement you'd get from Semgrep, but sourced from your own natural language instructions.

- **Instruction Verifier:** We prove the agent obeyed your prompt. `totem init` auto-ingests your existing `.cursorrules` and `.mdc` files.
- **Deterministic Execution:** `totem lint` uses Tree-sitter AST parsing. No LLM, no hallucination, and no API keys required.
- **Continuous Learning:** Catch a bug in a PR? Run `totem extract` to compile a new invariant, ensuring that specific bug never merges again.
- **Universal Baseline:** 60 lessons ship out of the box based on real failures from Vercel, Meta, and Prisma. Covers critical application domains:
  - **Frontend:** React hooks, SSR hydration.
  - **Backend & Data:** Async traps, database migrations.
  - **Tooling:** TypeScript safety, AI workflow guardrails.

**Totem is not another AI orchestration framework.** It is a closed-loop enforcement tool for the tools you already use.

## The Solo Dev Superpower

If you're a solo dev or small team using multiple AI agents (Cursor + Claude Code, Gemini + Copilot), Totem is your **Shared Memory Bus**.

- Lessons learned in one agent session are available to all agents via MCP.
- Rules compiled from Cursor instructions are enforced in Claude Code's pre-push hook.
- Share knowledge and lessons between local repositories using `totem link` (#612).
- `totem stats` shows your team (or your boss) exactly how many violations were prevented.

Stop repeating "no, use Zod here" to every agent in every session. Teach Totem once. It remembers forever.

## Enterprise Grade

Totem is architected for high-compliance sectors (defense, finance, healthcare).

- **Security & Compliance:**
  - **Air-Gapped Linting:** `totem lint` requires zero API keys and runs entirely locally. Your codebase never leaves your machine.
  - **DLP Secret Masking:** Automatically strips secrets before embedding. This ensures credentials never leak into your vector index.
  - **SARIF 2.1.0 Output:** Integrates into CI security scanners via `--format sarif/json`. Prove SOC 2 / DORA compliance to your auditors.
- **Rule Architecture:**
  - **Severity Levels:** Rules are classified as `error` (blocks CI) or `warning` (informs, doesn't block) (#616).
  - **Categorization:** 137 compiled rules span invariants, style, and security (83 invariants, 54 guidance rules).

Built on the same architecture as elite AI assistants (Tree-sitter + LanceDB), but pointed at enforcement, not generation. Both deterministic `totem lint` and AI-powered `totem shield` share a unified execution core for consistent rule evaluation.

## Works With Everything

- **Editors:**
  - Cursor
  - Windsurf
  - GitHub Copilot
  - JetBrains Junie
- **Agents:**
  - Claude Code (with native `totem spec` and `totem lint` hooks)
  - Gemini CLI
  - Aider
- **Orchestrators:**
  - Anthropic
  - Google GenAI
  - OpenAI
  - Ollama (Local fallback via graceful degradation)
- **CI Integration:**
  - GitHub Actions (SARIF)
  - Any CI that runs Node

---

## Commands

| Command   | What it does                                               | Speed    |
| --------- | ---------------------------------------------------------- | -------- |
| `lint`    | Compiled rules against diff. Zero LLM.                     | ~2s      |
| `shield`  | AI-powered code review with knowledge retrieval.           | ~18s     |
| `stats`   | The Trap Ledger — violations prevented, by category.       | instant  |
| `link`    | Share local knowledge and lessons between repositories.    | instant  |
| `compile` | Compile lessons + `.cursorrules` into deterministic rules. | ~5s/rule |
| `extract` | Learn from PR reviews.                                     | ~15s     |
| `spec`    | Pre-work briefing from knowledge base.                     | ~20s     |
| `sync`    | Build/update the vector index.                             | ~30s     |

Full reference: [CLI Reference Wiki](./docs/wiki/cli-reference.md)

## Contributing

We welcome contributions. See `CONTRIBUTING.md` and the [Dev Onboarding Wiki](./docs/wiki/dev-environment-setup.md).

## License

Licensed under the Apache 2.0 License.

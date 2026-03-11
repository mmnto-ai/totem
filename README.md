# Totem

> [!WARNING]
> **Developer Preview / Early Alpha**
> Totem is currently in early alpha. While Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, we are still polishing the "Magic Onboarding" experience (interactive tutorials). If you encounter friction during `totem init`, please bear with us!

**Your AI team forgets. Totem remembers.**

Right now, AI development is where code versioning was before Git. Every time you open a new AI session, your agents have amnesia. They forget why you chose Drizzle over Prisma, they hallucinate deprecated database tables, and they fall into the same architectural traps you fixed last week.

**Totem is the state manager for your AI's brain.**

It is an **AI Control Plane for Local Development**. Instead of uploading your proprietary codebase to a cloud SaaS platform, Totem compiles a syntax-aware, embedded vector index (LanceDB) right inside your project. It acts as an **Architectural Linter**, using the standard Model Context Protocol (MCP) to force your local agents (Claude, Gemini, Cursor) to read your project's constraints, decisions, and trap-logs _before_ they write a single line of code.

When you're three levels deep in a debugging session, you need to know if the code you are writing is real, or just an AI hallucinating an anti-pattern you banned three months ago. You need a totem.

## Why Totem?

- **Local-First & Git-Native:** Totem compiles an embedded LanceDB vector index directly inside your project, storing actual knowledge in a human-readable, version-controlled `.totem/lessons.md` file. Review your AI's memory locally in your PRs instead of locking it in a cloud SaaS.
- **The Reflex Engine:** Totem gives your AI reflexes by auto-injecting behavioral triggers and Defensive Context Management Reflexes into system prompts. This forces them to autonomously document traps, query architecture, and issue warnings before writing code (#160).
- **Multi-Agent Orchestration:** Use Claude to write code, Gemini to review PRs, and a local DeepSeek model for fast checks. Totem acts as the "Shared Brain" and workflow orchestrator for your entire AI org chart.
- **Built for Enterprise Scale:** The ingestion pipeline streams chunks in batches, maintaining a flat memory footprint regardless of monorepo size (#104). Features like Drift Detection ensure your memory stays self-cleaning and relevant as the codebase evolves (#211).

## Philosophy: The Unix Approach to AI

The tech industry is currently trying to build massive, monolithic "AI Developer Platforms" — web apps where you type a prompt and a black-box swarm of cloud agents writes the code for you.

Developers hate black boxes.

Totem applies the **Unix Philosophy** to AI orchestration. We believe AI models are just standard IO processes. You don't need a heavy web UI to orchestrate them; you just need a CLI.

By building our orchestrator as discrete, composable commands (`spec`, `shield`, `triage`, `docs`), we keep the developer in the terminal. You define the "Traction Points." If an AI generates a bad plan, you can run `totem spec --raw` to debug the context, edit the markdown, and fix it yourself. We don't replace your editor; we provide the invisible, configurable plumbing that connects your local agents together.

## Architecture

This is a Turborepo monorepo consisting of:

- **`@mmnto/totem`**: The core logic using **Tree-sitter for Universal AST Parsing**, syntax-aware chunking, and the LanceDB interface. Includes a deterministic lesson compiler backed by compiled rules and cross-model export targets (#213, #269).
- **`@mmnto/cli`**: The executable interface (`totem init`, `totem sync`).
- **`@mmnto/mcp`**: The standard I/O Model Context Protocol (MCP) server that exposes the `search_knowledge` and `add_lesson` tools to your AI.

## Security & Privacy

- **100% Local Privacy:** Totem's vector database (`.lancedb/`) lives entirely within your local repository. Your codebase is never uploaded to a centralized SaaS platform or external memory service.
- **Injection & ReDoS Hardening:** Totem actively sanitizes untrusted inputs and neutralizes terminal injection attacks.
  - **Prompt Security:** Applies SECURITY NOTICES to PR comments during extraction and XML-delimits MCP responses to mitigate indirect prompt injection (#149, #279).
  - **Adversarial Defense:** Implements adversarial content scrubbing in the ingestion pipeline and neutralizes ANSI terminal injection in Git outputs (#292, #315).
  - **Lesson Sandboxing:** Actively detects and blocks suspicious lessons even in bypass modes, minimizing false positives while applying ReDoS protection to compiled rules (#218, #326).
  - **System Integrity:** Enforces path containment checks in drift detection and formalizes explicit consent models for specific providers (#284, #311).
- **Continuous Auditing:** The repository utilizes Dependabot for automated security vulnerability scanning to ensure dependencies remain secure (#267). Internal strategies and sensitive planning are isolated in a properly configured private submodule for secure collaboration (#300).

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org/) (or use a version manager like `nvm`/`fnm`)
- **pnpm** _(recommended)_ — `corepack enable` or see other methods at [pnpm.io/installation](https://pnpm.io/installation)
- **GitHub CLI (`gh`)** _(optional, for orchestrator commands)_ — [cli.github.com](https://cli.github.com/)

Totem works on **Windows**, **macOS**, and **Linux** (#210). On Windows, Git Bash (bundled with [Git for Windows](https://gitforwindows.org/)) is recommended but not required — PowerShell and CMD work too.

## Getting Started

### 1. Initialize Totem

Run this inside your consuming project (e.g., your Next.js or Node app):

```bash
npx @mmnto/cli init
```

This will auto-detect your project structure and package manager (including Bun #316), generate a `totem.config.ts` using **Minimum Viable Configuration (MVC) tiers**, and inject the Proactive Memory Reflexes into your AI's system prompt.

- **Universal Baseline:** During init, Totem offers to install a curated set of foundational AI developer lessons. This includes prompt injection prevention, hallucination traps, and dependency verification so agents have useful knowledge from Day 1 (#128).
- **Seamless Host Integration:** If you are using Claude Code or Gemini CLI, `totem init` automatically wires up agent hooks (including native `SessionStart` hooks #95) to run `totem briefing`.
  - **Git Hook Enforcement:** Safely detects non-bash hooks before appending, seamlessly navigating to the git root in monorepo sub-packages (#317, #333).
  - **Commit Gates:** Intercepts pushes to run `totem shield` automatically, and can block direct commits to `main` while executing deterministic shield gates (#310).
  - **CI Safety:** Guards against missing CLI execution environments in CI pipelines to keep workflows unblocked (#336).

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

#### Drift Detection (Self-Cleaning Memory)

Over time, lessons in `.totem/lessons.md` can reference files or paths that no longer exist. Use `--prune` to detect and interactively remove stale lessons (#211):

```bash
npx @mmnto/cli sync --prune
```

Totem scans each lesson for backtick-wrapped file paths and checks if they still exist on disk with strict path containment (#284). It then presents a multi-select prompt to prune orphaned entries, automatically re-syncing the vector index afterward.

### 4. Connect the MCP Server

Add Totem to your AI agent's configuration (e.g., Claude Desktop, Claude Code, or Gemini).

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

> [!NOTE]
> On Windows, `npx` is a `.cmd` script that tools like Claude Code cannot invoke directly as a subprocess. The `cmd /c` wrapper resolves this. If you use Git Bash as your shell, the macOS/Linux format may also work.

### 5. The Workflow Orchestrator

> [!NOTE]
> **Prerequisite:** Currently, all orchestrator commands that fetch remote data (like `spec`, `triage`, and `extract`) require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed. Adapters for other platforms are on the roadmap.

Totem ships with native CLI commands that orchestrate your entire shift-left workflow by querying LanceDB and invoking your AI to make project-aware decisions.

First, configure your orchestrator in `totem.config.ts`. To keep the core CLI lightweight, Totem uses a **"Bring Your Own SDK" (BYOSD)** pattern. If you choose a native API provider, you must install its corresponding SDK as a dev dependency.

- **Native Providers:** Direct integrations for Anthropic and Gemini (#229).
- **OpenAI-Compatible:** Generic orchestrator for local and OpenAI API models (#285).
- **Ollama Native:** Dedicated Ollama orchestrator with dynamic context length support (`num_ctx` #298).
- **Generic Shell:** Fallback command line adapter.

```bash
# If using provider: 'gemini'
pnpm add -D @google/genai

# If using provider: 'anthropic'
pnpm add -D @anthropic-ai/sdk

# If using provider: 'openai' (or generic local providers / Ollama)
pnpm add -D openai
```

Overrides support **cross-provider routing** (using the `provider:model` syntax) and negated glob patterns for fine-grained model selection (#243, #246).

```typescript
// totem.config.ts
orchestrator: {
  provider: 'gemini', // Requires @google/genai (or 'openai' / 'ollama' for local setups)
  defaultModel: 'gemini-3-flash-preview',
  overrides: {
    spec: 'anthropic:claude-3-7-sonnet-latest', // Cross-provider routing
    shield: 'gemini-3.1-pro-preview',
    triage: 'gemini-3.1-pro-preview'
  }
}
```

Totem continuously audits default model IDs across all providers (#324). For a complete list of verified models and configuration routing strings, consult the supported models reference document (#325).

**Workflow Commands:**

- **`briefing`**: Fetches your current git branch, uncommitted changes, open PRs, and recent session momentum to generate a startup briefing.
- **`bridge`**: Assesses your current mid-task state and creates a lightweight breadcrumb file. Use this when your AI agent's context window gets too full.
- **`spec <ids...>`**: Fetches GitHub Issues (supports URLs) and synthesizes a pre-work spec. The AI acts as a **Staff-Level Architect**, focusing on contracts and edge cases.
- **`shield`**: Reads your uncommitted git diff and queries LanceDB for related traps to perform an architectural code review before you push.
  - **Zero-LLM Mode:** Lightning-fast deterministic checks using compiled rules, Tree-sitter AST gating, and structural review (#216, #287).
  - **False-Positive Mitigation:** Handles non-code contexts smartly and supports inline suppression directives (#251, #255).
  - **Workflow Integration:** Local git hooks enforce rules by blocking direct commits to main, and supports optional lesson extraction from verdicts (#303, #310).
- **`triage`**: Fetches open GitHub issues and generates a prioritized roadmap (e.g., `docs/active_work.md`) for your next task.
- **`compile`**: Compiles `.totem/lessons.md` into deterministic regex/AST rules for zero-LLM checks. Supports cross-model lesson export to enforce architectural constraints across different agent environments, including GitHub Copilot instructions (#269, #294).
- **`add-lesson`**: Interactively document a context, symptom, and fix. Saves to `.totem/lessons.md` and triggers a background re-index.
- **`docs`**: Automatically syncs project documentation by analyzing git logs and closed issues since the last release (#190). Supports targeting individual files with path fixes and strict state preservation to prevent hallucination (#238, #249).
- **`wrap`**: A post-merge workflow chain that runs `extract`, syncs the database, generates a roadmap, and updates docs in one command (#143).
- **`extract <ids...>`**: Fetches merged PRs, reads comments, and extracts systemic architectural traps with concise, descriptive headings (#203, #271).
  - **Security Hardening:** Strictly hardens against prompt injection and actively blocks suspicious lessons to prevent poisoned extractions (#279, #290).
  - **Curation:** Supports interactive multi-select pruning and the `--pick` flag for selective lesson acceptance (#265).
- **`handoff`**: Captures uncommitted changes and lessons learned today, synthesizing a tactical snapshot for your next session. Supports a `--lite` flag for rapid, zero-LLM session snapshots with ANSI-sanitized git outputs (#281, #292).
- **`hooks`**: Installs or updates background git hooks, automatically resolving the git root in monorepo sub-packages (#333). Ideal for wiring into `prepare` scripts to auto-install enforcement hooks across your team (#332).
- **`eject`**: Safely removes all Totem git hooks, configuration files, AI agent prompt injections, and the local `.lancedb/` index (#131).

> [!TIP]
> **Custom Prompt Overrides**
> Customize any command by creating a markdown file in `.totem/prompts/<command>.md` (e.g., `.totem/prompts/shield.md`) (#120).

### 6. Shield GitHub Action (CI/CD)

Enforce Totem's deterministic quality gate automatically on every pull request to maintain an air-gapped architectural safety net.

- **Performance:** Requires zero API keys and executes in milliseconds using your compiled rules (#180).
- **Flexibility:** False positives can be easily bypassed using standard inline suppression directives (#255).
- **Reliability:** CI Drift Gate prevents structural regressions, and local pre-push gates gracefully bypass if the CLI is missing in CI environments (#214, #336).

```yaml
# .github/workflows/shield.yml
name: Totem Shield
on:
  pull_request:
    branches: [main]

jobs:
  deterministic-shield:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build # (Or whatever command builds your project)
      - name: Run deterministic shield
        run: npx @mmnto/cli shield --deterministic
```

## Platform Notes

### Windows

- **Git hooks** installed by `totem init` run via Git for Windows' bundled shell (MinGW/bash) and work transparently regardless of your primary terminal (PowerShell, CMD, or Windows Terminal).
- **Path separators:** `totem.config.ts` uses forward slashes (`src/**/*.ts`) on all platforms. Do not use backslashes in glob patterns.
- **Environment variables:** `totem init` writes your `OPENAI_API_KEY` to a `.env` file, so no need to set `export` or `$env:` manually.

### Advanced: Pinning the MCP Server Version

The default `npx -y @mmnto/mcp` setup always uses the latest version. For teams that need deterministic builds, you can pin the version by installing it as a dev dependency:

```bash
pnpm add -D @mmnto/mcp
```

Then remove the `-y` flag from your MCP config — `npx` will use the locally installed version instead of fetching from the registry.

### macOS / Linux

- **Ollama:** If using Ollama for embeddings or local orchestration, ensure it is installed and running (`ollama serve`) before executing `totem` commands.
  - **macOS:** Install with `brew install ollama`.
  - **Linux:** Follow the [official Ollama installation guide](https://github.com/ollama/ollama/blob/main/docs/linux.md).

## Strategic Roadmap

Totem is evolving from a memory database into a full Shift-Left orchestrator.

- [x] **Foundations & Phase 1 (Onboarding):** Established the local vector DB, MCP interface, and MVC Configuration Tiers. Includes the "Universal Lessons" baseline and cross-platform docs.
- [x] **Phase 2 (Core Stability):** Delivered 60+ improvements across six capability areas. See `CHANGELOG.md` for the full list.
  - **AST & Chunking:** Tree-sitter universal parsing, deterministic lesson compiler, and AST gating.
  - **Orchestration:** Native API providers (Gemini, Anthropic, OpenAI, Ollama), cross-provider routing, and conformance suites.
  - **Doc Sync & Memory:** Automated doc sync, drift detection, and cross-model lesson export (including Copilot).
  - **Shield & CI:** Shield GitHub Action, structural review, inline suppression, and CI drift gates.
  - **Security:** Adversarial ingestion scrubbing, extract prompt hardening, and ANSI sanitization.
  - **DX & Hooks:** Git hook enforcement, monorepo-aware `hooks` command, and CI environment guards.
- [x] **Validation:** Internal dogfooding (#8) across multiple real-world repositories.
- [ ] **Phase 3 (Workflow Expansion):** Interactive CLI tutorials (#129), Custom Workflow Runner (#119), Agent-Optimized MCP (#176), and Cross-File Knowledge Graph (#183).

For a deeper dive into the system design, see `docs/architecture.md`.

## Contributing

We welcome community contributions! Please review our `CONTRIBUTING.md` guidelines. Note that all external contributions require signing our automated Contributor License Agreement (CLA) (#258), and internal strategy discussions have been migrated to a properly configured private submodule for secure collaboration (#300).

## License

Licensed under the Apache 2.0 License.

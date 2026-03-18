# Totem

**Stop repeating yourself to your AI.**

_AI coding agents are brilliant goldfish. Totem gives them a memory._

A zero-config CLI and MCP Server that compiles your project's architectural rules into deterministic CI guardrails. It creates a persistent, model-agnostic context layer that outlasts any single AI session — so Claude, Cursor, Gemini, and Copilot all enforce the same rules without being told twice.

Totem doesn't ship with your app. It lives in your workflow. It also works on non-code repositories — docs, ADRs, infrastructure configs, personal notes — via `totem init --bare`.

## The 10-Second Workflow

```bash
$ npx @mmnto/cli lint
✓ PASS — 147 rules, 0 violations.

$ npx @mmnto/cli stats
Total violations prevented: 47 | security: 12, architecture: 35
```

Write code with your AI. Run `totem lint`. Push with confidence. Run `totem stats` to prove your ROI.

## Quickstart

### 1. Initialize

```bash
npx @mmnto/cli init
```

Auto-detects your environment (Cursor, Copilot, Junie) and sets up `totem.config.ts`. You can also use `totem init --bare` to skip defaults and start with a clean slate.

Ships with **60 battle-tested lessons** extracted from PR reviews across major ecosystem tools:

- **Frameworks:** Next.js, React.
- **Data Layer:** Prisma, Drizzle.
- **Styling:** Tailwind.

Your project gets immediate protection against the most common architectural traps on Day 1. Already have `.cursorrules` or `.mdc` files? `totem init` auto-ingests them and compiles your instructions into deterministic rules.

### 2. Connect the MCP Server _(optional)_

> **Without MCP:** `totem lint`, `compile`, `extract`, `sync`, `explain`, and `stats` all work standalone. You get full deterministic enforcement and the complete CLI experience.
> **With MCP:** Your AI agent gains live access to the knowledge index mid-session. It can `search_knowledge` before writing code and `add_lesson` when it discovers traps.

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

During `init`, Totem prompts to install a `pre-push` git hook that runs `totem lint` automatically before every push. It drops a standard shell script into `.git/hooks/` to work alongside Husky or bare repos. Run `totem hooks --check` to verify installation at any time.

## The Planning Pipeline

Before your AI writes a single line of code, `totem spec` builds a threat-modeled implementation plan:

```bash
$ npx @mmnto/cli spec 570
[Spec] Linked index: .strategy
[Spec] Querying Totem index...
[Spec] Found: 5 specs, 3 code, 0 lessons
```

`totem spec` fetches your issue, queries the knowledge index for architectural traps, and generates a spec complete with invariants and baseline fix guidance. It tells your AI agent exactly what to build and what mistakes to avoid.

Cross-totem queries via `linkedIndexes` let the planner pull context from multiple projects simultaneously. Strategy docs can inform code decisions, while shared design systems inform component repositories.

## What Totem Actually Is

**A persistent memory that every AI agent shares.**

AI coding agents are brilliant but forgetful. They'll nail a complex algorithm, then immediately violate the architectural rule you corrected them on five minutes ago. Totem fixes this by creating a layer that persists across sessions, across models, and across tools.

- **Compile:** Your `.cursorrules` and `.mdc` files are plain English. Totem compiles them into deterministic AST and regex checks via the Tier 2 AST engine.
- **Enforce:** `totem lint` is **100% deterministic** and runs compiled rules against your diff. It runs in ~2 seconds with zero API keys, and your CI passes or fails based purely on logic.
- **Learn:** Run `totem extract` to compile new invariants from PR bugs, ensuring specific mistakes can never be merged again. When a violation happens, use `totem explain` to instantly retrieve the underlying lesson.
- **Plan:** `totem spec` queries the knowledge index before your AI writes code, generating architectural invariants. The AI starts fully informed of past mistakes instead of starting blank.

**Totem doesn't replace your AI. It gives your AI a memory.**

## Switch Models Without Losing Context

Use Claude today, Gemini tomorrow, Copilot next week. It doesn't matter. Totem creates a persistent, model-agnostic layer that outlasts any single AI.

- **Shared memory:** Lessons learned in one session are available to all agents via MCP.
- **Portable rules:** Rules compiled from Cursor are enforced in Claude Code's pre-push hook. The enforcement is entirely model-independent.
- **Cross-project knowledge:** Share local lessons between repositories using `totem link`. Query multiple knowledge bases simultaneously via `linkedIndexes`.
- **Prove ROI:** `totem stats` shows exactly how many violations were prevented. It tracks prevention regardless of which AI introduced the code.

Teach Totem once. It remembers forever.

## Enterprise Grade

Totem is architected for high-compliance sectors (defense, finance, healthcare).

- **Security & Compliance:**
  - **Fully Air-Gappable:** `totem lint` requires zero API keys and zero network access. With Ollama for embeddings, the entire pipeline runs without external API calls.
  - **DLP Secret Masking:** Automatically strips secrets before embedding. Credentials never leak into your vector index.
  - **SARIF 2.1.0 Output:** Integrates into CI security scanners via `--format sarif/json`. Prove SOC 2 / DORA compliance to your auditors.
- **Reliability & Portability:**
  - **Concurrency Safety:** Filesystem concurrency locks ensure stable vector index syncs. They also guarantee safe simultaneous MCP mutations.
  - **Cross-Platform Readiness:** V1.0 portability audits guarantee consistent behavior across major operating systems.
  - **Index Stability:** Dimension mismatch detection via `index-meta.json` prevents database corruption. Auto-healing migrations handle embedder changes automatically.
  - **Error Handling:** Typed `TotemError` subclasses unify error domains and provide actionable recovery hints for resilient operations (#711).
- **Rule Architecture:**
  - **Curated Baselines:** Features a highly-curated 147-rule set with mandatory verify steps to guarantee execution determinism (#708).
  - **Severity Levels:** Rules are classified as `error` (blocks CI) or `warning` (informs, doesn't block).
  - **Categorization:** Compiled rules span security, architecture, style, and performance domains.

**What gets committed:** Your knowledge base (text files in `.totem/lessons/`) and the compiled artifact (`.totem/compiled-rules.json`). The `.lancedb/` vector index is a local-only cache, automatically rebuilt by `totem sync`. It is never committed to your repository.

Built on the same architecture as elite AI assistants (Tree-sitter + LanceDB), but pointed at enforcement, not generation.

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
| `explain` | Look up the lesson behind a violation.                     | instant  |
| `stats`   | The Trap Ledger — violations prevented, by category.       | instant  |
| `link`    | Share local knowledge and lessons between repositories.    | instant  |
| `compile` | Compile lessons + `.cursorrules` into deterministic rules. | ~5s/rule |
| `extract` | Learn from PR reviews.                                     | ~15s     |
| `spec`    | Pre-work briefing from knowledge base.                     | ~20s     |
| `sync`    | Build/update the vector index.                             | ~30s     |

Full reference: [CLI Reference Wiki](./docs/wiki/cli-reference.md)

# Troubleshooting

Manually maintained content that `totem docs` must include in the wiki.
This file is the source of truth for troubleshooting notes — edit here, not in the generated wiki.

## Git Hooks

### Hooks not firing on Mac/Linux

If you clone a repository that was initialized on Windows and the git hooks fail to fire, Git may not recognize them as executable. The `chmod` permissions are often lost in translation between Windows and POSIX filesystems.

**Fix:**

```bash
chmod +x .git/hooks/pre-push .git/hooks/post-merge
```

This applies the execute permission that POSIX systems require. Windows users are unaffected — Git Bash executes hooks regardless of the permission bit.

### Hooks not firing with Husky

If your project uses Husky, Totem's `install-hooks.js` detects `.husky/` and skips direct `.git/hooks/` installation. Add Totem's hook commands to your Husky config instead:

```bash
# .husky/pre-push
pnpm exec totem lint
```

## Ollama

### Model not found errors

If `totem sync` or `totem shield` fails with "model not installed" when using Ollama, the required model hasn't been pulled yet.

**Fix:**

```bash
# For embeddings (default model)
ollama pull nomic-embed-text

# For orchestration (use whatever model you configured)
ollama pull gemma2:27b
```

## Embeddings

### Dimension mismatch after switching providers

If you switch embedding providers (e.g., from OpenAI 1536d to Gemini 768d), the existing `.lancedb` index becomes incompatible.

**Fix:**

```bash
rm -rf .lancedb
totem sync
```

This rebuilds the index from scratch with the new dimensions.

## Contributing

We welcome contributions. See `CONTRIBUTING.md` and the [Dev Onboarding Wiki](./docs/wiki/dev-environment-setup.md).

## License

Licensed under the Apache 2.0 License.

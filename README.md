# Totem

**Stop repeating yourself to your AI.**

_AI coding agents are brilliant goldfish. Totem gives them a memory._

A zero-config CLI and MCP Server that compiles your project's architectural rules into deterministic CI guardrails. It creates a persistent, model-agnostic context layer that outlasts any single AI session — so Claude, Cursor, Gemini, and Copilot all enforce the same rules without being told twice.

Totem doesn't ship with your app. It lives in your workflow. It also works on non-code repositories — docs, ADRs, infrastructure configs, personal notes — via `totem init --bare`.

## Capabilities

Totem is a two-part governance system: a probabilistic **Memory Layer** for AI agents, and a deterministic **Enforcement Compiler** for Git pipelines.

*   **Zero-LLM Enforcement:** Rules compile into Tree-sitter AST and regular expressions. `totem lint` executes in <2 seconds without API keys, network access, or an LLM.
*   **Air-Gapped Operation:** Supports fully offline embedding via Ollama and local LLM execution. 
*   **Cross-Repository Mesh:** Use `totem link` to share compiled invariants across multiple codebases.
*   **Editor Agnostic:** Enforces boundaries at the Git layer (`pre-push`), neutralizing agent divergence regardless of whether code was written by Cursor, Copilot, or Claude Code.
*   **Compliance Ready:** Outputs standard SARIF 2.1.0 for native integration into GitHub Advanced Security and enterprise DORA dashboards.

## Example: Rule Compilation

Totem translates natural language constraints into explicit AST execution arrays. 

**Input:** (`.totem/lessons/no-console.md`)
```markdown
## Lesson — Never use console.log
Tags: architecture
Always use the structured Pino logger instead of raw console.log.
```

**Output:** (`.totem/compiled-rules.json`)
```json
{
  "heading": "Never use console.log",
  "engine": "ast-grep",
  "rule": "pattern: 'console.log($$$)'",
  "severity": "error"
}
```

## Quickstart

### 1. Initialize Project
```bash
npx @mmnto/cli init
```
This scaffolds `totem.config.ts` and ingests existing `.cursorrules` or `.mdc` files into the compilation pipeline.

### 2. Connect MCP (Optional)
The MCP server provides live read/write access to the vector index during active AI sessions.

**macOS / Linux (`mcp.json`):**
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

### 3. Compile and Enforce
```bash
npx @mmnto/cli sync    # Build the local vector index
npx @mmnto/cli lint    # Run compiled rules against staged/uncommitted files
```

During `init`, Totem installs standard bash hooks into `.git/hooks/` (or integrates with Husky) to block `git push` if AST rule violations are detected.

---

## Commands

<!-- docs COMMAND_TABLE -->
| Command | Description |
| --- | --- |
| `init` | Initialize Totem in the current project |
| `sync` | Re-index project files into the local vector store |
| `search` | Search the knowledge index |
| `stats` | Show index statistics |
| `explain` | Look up the lesson behind a compiled rule violation |
| `spec` | Generate a pre-work spec briefing for GitHub issue(s) or topic(s) |
| `lint` | Run compiled rules against your diff (zero LLM, fast) |
| `shield` | AI-powered code review: analyze your diff against Totem knowledge |
| `triage` | Prioritize open issues into an active work roadmap |
| `handoff` | Generate an end-of-session handoff snapshot for the next session |
| `add-lesson` | Interactively add a lesson to project memory (or pass string as argument) |
| `compile` | Compile lessons into deterministic regex rules for zero-LLM shield checks |
| `verify-manifest` | Verify compiled-rules.json matches the compile manifest (CI gate) |
| `test` | Run test fixtures against compiled rules (TDD for governance rules) |
| `extract` | Extract lessons from PR review(s) into .totem/lessons/ (interactive cherry-pick) |
| `eject` | Remove all Totem hooks, config, and data from this project |
| `wrap` | Post-merge workflow: learn from PR(s), sync index, then triage |
| `docs` | Auto-update registered project docs using LLM synthesis |
| `lint-lessons` | Validate lesson metadata (patterns, scopes, severity) |
| `drift` | Check lessons for stale file references (CI gate) |
| `hooks` | Install git hooks (pre-commit, pre-push, post-merge) non-interactively |
<!-- /docs -->

Full reference: [CLI Reference Wiki](./docs/wiki/cli-reference.md)

# Troubleshooting

Manually maintained content that `totem docs` must include in the wiki.

## Git Hooks Not Firing (Mac/Linux)
If initialized on Windows, POSIX executable bits may be lost in cross-platform clone operations.

<!-- docs CHMOD_HOOKS -->
```bash
chmod +x .git/hooks/pre-commit .git/hooks/pre-push .git/hooks/post-merge .git/hooks/post-checkout
```
<!-- /docs -->

## Dimension Mismatch (Embedder Switch)
If `totem sync` throws a dimension mismatch error (e.g., swapping OpenAI for Ollama), delete the local index cache and resync.

```bash
rm -rf .lancedb
totem sync
```

## Documentation
*   [Architecture & Governance Model](./docs/architecture.md)
*   [Roadmap](./docs/roadmap.md)
*   [Contributing](./CONTRIBUTING.md)

## License
Apache 2.0 License.
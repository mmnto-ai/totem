# CLI Command Reference

This document provides a detailed breakdown of the `totem` command-line interface.

> **Note:** All orchestrator commands (like `spec`, `triage`, and `extract`) currently require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed on your system.
>
> **Global Flags:** Every Totem command supports the `--json` flag to output structured JSON instead of human-readable text. This makes it trivial to pipe Totem into your own automation scripts or UI dashboards (e.g., `totem status --json`).

> **Standalone Binary (Totem Lite):** If you are using the compiled standalone binary (no Node.js required), certain commands that require the LLM orchestrator or local Vector database are excluded to keep the binary small (~35MB).
>
> - **Available in Lite:** `init`, `lint`, `hooks`, `compile` (AST/Regex), `doctor`, `status`, `rule list`
> - **Excluded in Lite:** `review`, `sync`, `extract`, `spec`, `triage`
>
> Excluded commands will show a `[Totem Lite]` tag in the `--help` menu and will exit with status code `78` (Configuration Error) if invoked, prompting you to install the full Node.js package.

---

## Initialization & Setup

### `totem init`

Auto-detects your project structure, package manager, and installed AI agents. It scaffolds `totem.config.ts`, injects the Proactive Memory Reflexes into your agent's instruction files (e.g., `CLAUDE.md`, `GEMINI.md`), and automatically seeds the project with the **Universal Baseline**.

- **Flags:**
  - `--bare`: Initializes Totem in a zero-config mode optimized for non-code repositories (e.g., Markdown notes, Obsidian vaults, documentation sites). Skips Git hooks, orchestrator detection, and API key prompts, forcing the Lite tier so you can use Totem as a local MCP RAG server without developer tooling overhead.

### `totem hooks`

Installs or updates background git hooks (`pre-commit`, `pre-push`, `post-merge`, `post-checkout`). Automatically resolves the git root in monorepo sub-packages.

- **Flags:**
  - `--force`: Overwrites existing Totem hooks. Use this after a major version upgrade.
- **Troubleshooting (Mac/Linux):** If you clone a repository initialized on Windows and the hooks fail to fire, Git may not recognize them as executable. Fix this by running: `chmod +x .git/hooks/pre-commit .git/hooks/pre-push .git/hooks/post-merge .git/hooks/post-checkout`

### `totem config`

Displays or manages the current Totem configuration.

### `totem describe`

Outputs a structured description of the project's governance parameters for MCP and AI agent consumption.

### `totem doctor`

Runs a battery of automated health checks to verify config bloat, index health, hook wiring, and secret hygiene.

- **Flags:**
  - `--ci`: Exits with a non-zero status code if critical checks fail.
  - `--pr`: Analyzes the Trap Ledger and auto-downgrades rules with a >30% bypass rate by generating a GitHub Pull Request (Self-Healing Loop).

### `totem status` / `totem check`

Provides a high-level overview of project health, including active exemptions, shield status, and index state. `totem check` runs enforcement health checks.

### `totem eject`

Safely removes all Totem git hooks, config files, agent prompt injections, and the local `.lancedb/` index.

---

## Rules & Enforcement

### `totem lint`

Stateless, zero-LLM linting against `compiled-rules.json`. It reads the compiled constraints and evaluates your local files.

### `totem rule list` / `totem rule scaffold`

Manage your deterministic rules (Pipeline 1). `rule list` outputs active rules, and `rule scaffold` creates a template for manual rule authoring.

### `totem import`

Imports rules from existing tools into the Totem engine (Pipeline 4).

- **Flags:**
  - `--from-eslint <path>`: Import rules from ESLint configuration. Supported rules:
    - `no-restricted-imports` (paths and patterns)
    - `no-restricted-globals` (string array)
    - `no-restricted-properties` (object.property pairs, including dot, optional chaining, and bracket notation)
    - `no-restricted-syntax` (supported node types: ForInStatement, WithStatement, DebuggerStatement; other selectors are silently skipped)
  - `--from-semgrep <path>`: Import rules from Semgrep YAML files.
  - `--out <path>`: Specify an output path.
  - `--dry-run`: Preview the import without saving.

### `totem gc-rules`

Garbage collect stale or unused rules from the compilation manifest.

### `totem verify-manifest`

Verifies the integrity of the compiled rule manifest against current active rules.

### `totem explain <hash>`

Looks up the original markdown lesson behind a deterministic rule violation. Supports partial hash prefixes. The command runs locally in milliseconds with zero LLM overhead, so a junior developer stuck on an architectural block gets an asynchronous mentor without waiting for a human reviewer.

### `totem exemption`

Manage rule exemptions for specific files or lines that deliberately bypass a structural constraint.

### `totem review`

The core of the Codebase Immune System. Reads your uncommitted diff and checks it against compiled rules and vector DB traps. Pipeline 5 automatically captures warnings from findings.

- **Flags:**
  - `--deterministic`: Runs lightning-fast zero-LLM checks using `compiled-rules.json` (sub-3 seconds).
  - `--format sarif`: Exports violations in SARIF 2.1.0 format.
  - `--format json`: Exports structured JSON including a unified `findings[]` array (ADR-071 Unified Findings Model) alongside raw `violations[]`.
  - `--learn`: Prompts you to extract a new lesson if a violation is found.
  - `--no-auto-capture`: Disables Pipeline 5 observation auto-capture during the review.

### `totem test`

The Rule Simulator. Runs `compiled-rules.json` against local `pass.ts` and `fail.ts` fixtures to empirically prove a rule works before deployment.

### `totem drift`

Detects architectural drift by comparing the current codebase state against historical baselines.

---

## Memory & Synchronization

### `totem sync`

Parses your codebase, chunks the AST, and builds the local LanceDB vector index.

- **Flags:**
  - `--incremental`: (Default) Only indexes files changed since the last sync.
  - `--full`: Drops the existing index and rebuilds it entirely from scratch.
  - `--prune`: Interactively detects and removes stale lessons that reference deleted files.

### `totem search`

Searches the local knowledge index for lessons, code snippets, or rules relevant to a query.

### `totem stats`

Displays statistics about the vector index, rule bypass rates, and lesson counts.

### `totem add-lesson`

Interactively documents a context, symptom, and fix. Saves to `.totem/lessons.md` and triggers a background re-index.

### `totem lesson list`

Lists all locally documented lessons from `.totem/lessons.md` and the lessons directory.

### `totem lesson compile`

Compiles `.totem/lessons.md` into deterministic regex/AST rules for zero-LLM checks. Outputs to `compiled-rules.json`. Supports Pipeline 2 (LLM-generated) and Pipeline 3 (Example-based compilation).

- **Flags:**
  - `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out. (Note: Cloud compile is still routed to Gemini until #1221 ships).
  - `--concurrency <n>`: Sets parallel compilation limit (default: 5).
  - `--force`: Bypasses the compilation cache.
  - `--from-cursor`: Ingests `.cursorrules`, `.windsurfrules`, and `.cursor/rules/*.mdc` files as lessons.
  - `--upgrade <hash>`: Targets one rule by hash (full or short prefix), evicts only that rule from the cache (preserves `createdAt` metadata), recompiles through Sonnet with a telemetry-driven directive, and replaces the rule. Rejects `--cloud` (not supported) and `--force` (scoped eviction makes force redundant and dangerous).

### `totem extract <pr-ids...>`

Fetches merged PRs, reads comments, and extracts systemic architectural traps. Automatically infers scope from PR changed files.

- **Security:** Hardened against prompt injection via XML boundaries. Actively blocks suspicious lessons in all bypass modes.

---

## Context & Workflow

### `totem briefing`

Fetches your current git branch, uncommitted changes, open PRs, and recent session momentum. Generates a quick startup briefing for your AI.

### `totem triage`

Fetches open GitHub issues and generates a prioritized roadmap. Ideal for planning your next task in `docs/active_work.md`.

### `totem triage-pr <pr-number>`

Categorized bot review triage. Fetches CodeRabbit and GCA comments, heuristically maps their severities, and groups them by impact to prevent alert fatigue.

### `totem review-learn <pr-number>`

Extracts systemic lessons from resolved bot review comments on a merged PR. The other half of the Self-Healing Loop.

### `totem audit`

Performs a strategic backlog audit with a human approval gate. Synthesizes task dependencies.

### `totem spec <issue-ids...>`

Fetches GitHub Issues and synthesizes a pre-work spec. Injects a prior art concierge (shared helper registry) enriched by your project's vector DB lessons to prevent hallucinations.

### `totem bridge`

Assesses your current mid-task state and creates a lightweight breadcrumb file. Ideal for when your AI agent's context window gets too full and you need to start a new session.

### `totem handoff`

Captures uncommitted changes and lessons learned today for your next session.

- **Flags:**
  - `--lite`: An ANSI-sanitized, zero-LLM snapshot (fast).

### `totem wrap` (RETIRED)

Previously a 6-step post-merge workflow chain. Retired pending [mmnto-ai/totem#1361](https://github.com/mmnto-ai/totem/issues/1361) because the `totem docs` step silently overwrote hand-crafted committed documentation. Running the command now prints a hard error with the manual workaround sequence. Use the individual commands directly:

```bash
pnpm exec totem lesson extract <pr-numbers> --yes
pnpm exec totem sync
pnpm exec totem lesson compile --export
git checkout HEAD -- .totem/compiled-rules.json
pnpm run format
git add .totem/lessons/ .github/copilot-instructions.md .junie/skills/totem-rules/rules.md
git commit -m "chore: totem postmerge lessons for <prs>"
```

Three return conditions must ship before `totem wrap` comes back: a `--skip-docs` flag on wrap, a 24-hour git-author-date freshness guard on `totem docs`, and an end-to-end regression test that seeds a hand-crafted `active_work.md` and asserts the file survives the pipeline unmodified.

### `totem add-secret <value>`

Adds a user-defined secret to the local DLP pipeline (`.totem/secrets.json`). Secrets are automatically masked during lesson ingestion and shield reviews.

- **Flags:**
  - `--pattern`: Treat the value as a regex pattern instead of a literal string. Patterns are validated for syntax and **ReDoS safety**. Catastrophic backtracking patterns like `(a+)+$` are rejected at input time.

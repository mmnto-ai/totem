# CLI Command Reference

This document provides a detailed breakdown of the `totem` command-line interface.

> **Note:** All orchestrator commands (like `spec`, `triage`, and `extract`) currently require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed on your system.

---

## Initialization & Setup

### `totem init`

Auto-detects your project structure, package manager, and installed AI agents. It scaffolds `totem.config.ts`, injects the Proactive Memory Reflexes into your agent's instruction files (e.g., `CLAUDE.md`, `GEMINI.md`), and automatically seeds the project with the **Universal Baseline** (50+ curated architectural invariants mined from elite engineering teams).

If existing AI agent instructions (e.g., `.cursor/rules/*.mdc`) are detected during initialization, the command will prompt you to automatically ingest and compile them into deterministic CI guardrails.

- **Flags:** None required. Auto-detects environment tier (Lite, Standard, Full).

### `totem hooks`

Installs or updates background git hooks (`pre-commit`, `pre-push`, `post-merge`). Automatically resolves the git root in monorepo sub-packages.

- **Usage:** Typically run automatically during `pnpm prepare`.

### `totem doctor` _(Upcoming)_

Runs a battery of automated health checks to verify config bloat, index health, hook wiring, and secret hygiene.

- **Flags:**
  - `--ci`: Exits with a non-zero status code if critical checks fail.

### `totem eject`

Safely removes all Totem git hooks, config files, agent prompt injections, and the local `.lancedb/` index.

---

## Memory & Synchronization

### `totem sync`

Parses your codebase, chunks the AST, and builds the local LanceDB vector index.

- **Flags:**
  - `--incremental`: (Default) Only indexes files changed since the last sync.
  - `--full`: Drops the existing index and rebuilds it entirely from scratch.
  - `--prune`: Interactively detects and removes stale lessons that reference deleted files.

### `totem extract <pr-ids...>`

Fetches merged PRs, reads comments, and extracts systemic architectural traps.

- **Security:** Hardened against prompt injection via XML boundaries. Actively blocks suspicious lessons in all bypass modes.

### `totem compile`

Compiles `.totem/lessons.md` into deterministic regex/AST rules for zero-LLM checks. Outputs to `compiled-rules.json`.

### `totem add-lesson`

Interactively documents a context, symptom, and fix. Saves to `.totem/lessons.md` and triggers a background re-index.

---

## Architectural Control & Enforcement

### `totem shield`

The core of the Codebase Immune System. Reads your uncommitted diff and checks it against compiled rules and vector DB traps.

- **Flags:**
  - `--deterministic`: Runs lightning-fast zero-LLM checks using `compiled-rules.json` (sub-3 seconds).
  - `--format sarif`: Exports violations in SARIF 2.1.0 format for GitHub Advanced Security integration.
  - `--learn`: (Optional) Prompts you to extract a new lesson if a violation is found.

### `totem spec <issue-ids...>`

Fetches GitHub Issues and synthesizes a pre-work spec. The AI acts as a Staff-Level Architect, explicitly enriched by your project's vector DB lessons to prevent hallucinations.

### `totem test` _(Upcoming)_

The Rule Simulator. Runs the `compiled-rules.json` against local `pass.ts` and `fail.ts` fixtures to empirically prove a rule works before deployment.

---

## Context & Workflow

### `totem briefing`

Fetches your current git branch, uncommitted changes, open PRs, and recent session momentum. Generates a quick startup briefing for your AI.

### `totem triage`

Fetches open GitHub issues and generates a prioritized roadmap. Ideal for planning your next task in `docs/active_work.md`.

### `totem audit`

Performs a strategic backlog audit with a human approval gate. Synthesizes task dependencies.

### `totem bridge`

Assesses your current mid-task state and creates a lightweight breadcrumb file. Ideal for when your AI agent's context window gets too full and you need to start a new session.

### `totem handoff`

Captures uncommitted changes and lessons learned today for your next session.

- **Flags:**
  - `--lite`: An ANSI-sanitized, zero-LLM snapshot (fast).

### `totem wrap`

A post-merge workflow chain. Runs `extract`, syncs the database, generates a roadmap, and updates docs in one command.

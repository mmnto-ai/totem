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

Regex rules execute under a runtime timeout budget in a persistent worker thread so catastrophic-backtracking patterns (ReDoS) cannot hang the lint run. The timeout behavior is configurable via `--timeout-mode`:

- `--timeout-mode strict` (default) — any rule-file pair that exceeds the budget fails the lint run non-zero. This is the CI path.
- `--timeout-mode lenient` — skip the offending rule-file pair with a visible warning; exit code is unchanged. Useful for local iteration when a known-slow rule is under investigation.

Timeout outcomes land in `.totem/temp/telemetry.jsonl` tagged `type: 'regex-execution'` with repo-relative path redaction. This is distinct from the input-time ReDoS check on `totem add-secret --pattern` below — that rejects dangerous patterns at authoring time, while the lint-time budget enforces termination against any pattern that slips through.

For authoring patterns that pass the input-time gate, see [Regex Safety](regex-safety.md), which documents two empirically-verified safe forms for module-path-tolerant identifier matching (a class the gate makes non-obvious).

### `totem rule` (list / scaffold / promote)

Manage your deterministic rules (Pipeline 1).

- `rule list` outputs active rules.
- `rule scaffold` creates a template for manual rule authoring.
- `rule promote <hash>` flips a rule from `unverified` to active per ADR-089 (Zero-Trust Default). Pipeline 2 and Pipeline 3 LLM-generated rules ship `unverified: true` unconditionally; this command is the atomic activation surface. Supports partial hash prefixes; ambiguous prefixes print candidates and exit non-zero with no mutation. Idempotent.

### `totem install pack/<name>`

Installs a Totem pack from npm and merges its rules into your local manifest. Pack rules enter as `pending-verification` status and stay inert at lint time until the next `totem lint` runs the Stage 4 codebase verifier on each — only after that pass do rules promote to `active`, `archived`, or `untested-against-codebase` per their per-rule outcome. Verification outcomes are recorded in `.totem/verification-outcomes.json` (committable) so subsequent CI and local runs share the result and skip re-verification.

- **Flags:**
  - `--yes`: Auto-append the pack's `.totemignore` entries without showing the diff preview. Required in non-interactive contexts (CI).
- **Output:** After a successful install, the command prints `Run \`totem lint\` to activate pack rules` as a reminder that pack rules are inert until the first lint pass promotes them.

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

The core of the Codebase Immune System. Reads your uncommitted diff and checks it against compiled rules and vector DB traps. Pipeline 5 observation auto-capture is off by default; opt in per invocation with `--auto-capture`.

- **Flags:**
  - `--deterministic`: Runs lightning-fast zero-LLM checks using `compiled-rules.json` (sub-3 seconds).
  - `--format sarif`: Exports violations in SARIF 2.1.0 format.
  - `--format json`: Exports structured JSON including a unified `findings[]` array (ADR-071 Unified Findings Model) alongside raw `violations[]`.
  - `--learn`: Prompts you to extract a new lesson if a violation is found.
  - `--auto-capture`: Enables Pipeline 5 observation auto-capture during the review (off by default).
  - `--estimate`: Pre-flight deterministic-rule predictor (zero-LLM). Runs `compiled-rules.json` against the diff and prints predicted findings tagged `[Estimate]` so they are not conflated with an LLM verdict. Bypasses the entire Verification Layer — no orchestrator, no embedder, no LanceDB. Useful for predicting bot findings before opening a PR. Example: `totem review --estimate --diff main...HEAD`. Incompatible with `--learn`, `--auto-capture`, `--override`, `--suppress`, `--fresh`, `--mode`, and `--raw`.
  - `--no-history`: Disables the pattern-history overlay layer on the `--estimate` path. The overlay is on by default when `.totem/recurrence-stats.json` is present; pass `--no-history` to skip it. Has no effect on the LLM review path.

#### Pattern-history layer (mmnto-ai/totem#1731)

After the deterministic-rule pass, `--estimate` reads `.totem/recurrence-stats.json` (the substrate written by `totem stats --pattern-recurrence`) and emits a separate stanza listing historically recurring patterns whose tokens are present in the diff additions above a containment threshold of 0.4. The overlay output is tagged `[Estimate]` and rendered below the deterministic verdict with a blank-line separator so users cannot conflate "rule X will fire at file:line" with "this diff resembles a recurrent pattern that no rule yet covers."

- Patterns already covered by a compiled rule are skipped; the overlay surfaces only the `patterns[]` array, never `coveredPatterns[]`.
- Containment is asymmetric: at least 40% of the pattern's significant tokens (after the substrate's stopword + length filter) must appear in the diff additions for a match.
- Missing or malformed `.totem/recurrence-stats.json` degrades gracefully. The estimator logs a one-line hint and continues; the deterministic-pass output is unchanged.
- `--no-history` skips the overlay even when the substrate is present.

Example output stanza:

```text
[Estimate] ─── Pattern-history layer ───
[Estimate] 2 historical pattern(s) match this diff (uncovered by current rules):
[Estimate]
[Estimate]   a3f1c2d4e5b6 — 7x in PRs #1700, #1710, #1720 (containment: 0.83)
[Estimate]     "avoid using async-storage in render-path components"
```

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

Compiles `.totem/lessons.md` and `.totem/lessons/*.md` into deterministic regex / AST rules for zero-LLM checks. Outputs to `compiled-rules.json`. Supports Pipeline 2 (LLM-generated) and Pipeline 3 (Example-based compilation). Local compile routes to Sonnet 4.6 by default.

> **Note:** `totem compile` is a deprecated alias for `totem lesson compile`. The CLI's own `--help` output marks it as deprecated. New documentation should use the entity-grouped form (`totem lesson compile`); the `totem --help` `Entities:` section lists `rule`, `lesson`, `exemption`, `config` as the canonical command groupings.

- **Flags:**
  - `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out. (Note: Cloud compile is still routed to Gemini until #1221 migrates the cloud worker to Sonnet; local compile is the golden path.)
  - `--concurrency <n>`: Sets parallel compilation limit (default: 5).
  - `--export`: Re-exports compiled rules to AI tool config files per the `exports` map in `totem.config.ts`.
  - `--force`: Bypasses the compilation cache.
  - `--from-cursor`: Ingests `.cursorrules`, `.windsurfrules`, and `.cursor/rules/*.mdc` files as lessons.
  - `--upgrade <hash>`: Targets one rule by hash (full or short prefix), evicts only that rule from the cache (preserves `createdAt` metadata), recompiles through Sonnet with a telemetry-driven directive, and replaces the rule. Rejects `--cloud` (not supported) and `--force` (scoped eviction makes force redundant and dangerous).
  - `--refresh-manifest`: No-LLM primitive that recomputes the manifest's `output_hash` after manual edits to `compiled-rules.json` (e.g., archive lifecycle changes). Backs the atomic `totem lesson archive` command.

### `totem lesson archive <hash> --reason "<text>"`

Atomic archive command (1.15.2 / `mmnto-ai/totem#1587`). Flips a rule's `status` to `archived`, stamps `archivedAt` on first transition, refreshes `compile-manifest.json`'s `output_hash`, and regenerates the AI tool config exports — all in one invocation. Idempotent on rerun (`archivedReason` refreshes, `archivedAt` is preserved). Supports partial hash prefixes; ambiguous prefixes print candidates and exit non-zero with no mutation.

This is the canonical curation surface; reverting `compiled-rules.json` via `git checkout` is forbidden (creates a manifest hash mismatch that fails `verify-manifest` at push time).

### `totem lesson extract <pr-ids...>`

Fetches merged PRs, reads comments, and extracts systemic architectural traps. Automatically infers scope from PR changed files.

- **Security:** Hardened against prompt injection via XML boundaries. Actively blocks suspicious lessons in all bypass modes.

---

## Context & Workflow

### `totem triage`

Fetches open GitHub issues and generates a prioritized roadmap. Ideal for planning your next task in `docs/active_work.md`.

### `totem triage-pr <pr-number>`

Categorized bot review triage. Fetches CodeRabbit and GCA comments, heuristically maps their severities, and groups them by impact to prevent alert fatigue.

### `totem retrospect <pr-number>`

Bot-tax circuit-breaker (mmnto-ai/totem#1713). Analyzes a PR's bot-review history live, groups findings into push-based rounds (one round per `commit_id` from `gh api repos/.../pulls/N/reviews`), enriches each finding with cross-PR-recurrence flags from `.totem/recurrence-stats.json` and rule-coverage flags from `.totem/compiled-rules.json`, and emits a deterministic verdict for each finding: `route-out`, `in-pr-fix`, or `undetermined`. No LLM. No GitHub mutation. Read-only outside the optional `--out <path>` JSON write.

The classifier is a fixed table over the four-axis cube `(severityBucket × roundPosition × crossPrRecurrenceBucket × coveredByRule)`. Severity vocabulary is shared with `totem stats --pattern-recurrence` so the bot-tax cluster has a single source of truth.

- **Flags:**
  - `--threshold <n>`: Minimum bot-review round count to render the report (default: 5). Sub-threshold runs exit 0 with a benign skip; pass `--force` to inspect anyway.
  - `--force`: Bypass the threshold gate.
  - `--out <path>`: Write the JSON report to a file (deterministic two-space indent). Suitable for `jq` or GitHub Actions composition.

- **Threshold semantics:** below threshold → exit 0 with a one-line skip message (the circuit-breaker does NOT fail CI on benign PRs). At-or-above threshold → render the full report. Mirrors `totem stats --pattern-recurrence` default of `5`.

- **Graceful degrade:** missing or malformed `recurrence-stats.json` sets `substrateAvailable: false` and zeroes every finding's `crossPrRecurrence`; missing `compiled-rules.json` sets `compiledRulesAvailable: false` and forces `coveredByRule: false`. Both paths log a warning and continue — they do not abort.

- **Example:**

  ```bash
  totem retrospect 1732 --threshold 5 --out .totem/retrospect-1732.json
  ```

  Sample output excerpt:

  ```text
  [Retrospect] PR #1732 (open) — 7 round(s), 12 bot finding(s).
  [Retrospect]   substrate=available, compiled-rules=available, dedup-rate=42%
  [Retrospect]   tool: coderabbit:9 gca:3
  [Retrospect]   severity: medium:6 low:4 nit:2
  [Retrospect]   classification: in-pr-fix:8 route-out:3 undetermined:1
  [Retrospect] Route-out candidates (3):
  [Retrospect]   [r6] low 4f3a... — Avoid using `any` — prefer `unknown`. (covered by existing compiled rule)
  [Retrospect] Stop conditions:
  [Retrospect]   • If next round contains only nit-severity findings, ship + file 3 follow-up issue(s) for the route-out candidates above.
  ```

- **Not supported in this command:** `--auto-file` (mass issue filing), comment-drift detection, trap-ledger writes, LLM-driven classification.

### `totem review-learn <pr-number>`

Extracts systemic lessons from resolved bot review comments on a merged PR. The other half of the Self-Healing Loop.

### `totem spec <issue-ids...>`

Fetches GitHub Issues and synthesizes a pre-work spec. Injects a prior art concierge (shared helper registry) enriched by your project's vector DB lessons to prevent hallucinations.

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
# Curate over-broad rules via the atomic archive (1.15.2):
pnpm exec totem lesson archive <hash> --reason "<specific failure mode>"
pnpm run format
git add .totem/lessons/ .totem/compiled-rules.json .totem/compile-manifest.json \
  .github/copilot-instructions.md   # plus any export targets in your totem.config.ts `exports` map
git commit -m "chore: totem postmerge lessons for <prs>"
```

> **Do NOT** use `git checkout HEAD -- .totem/compiled-rules.json` to revert the rules file. Reverting rules while keeping new lessons on disk creates a manifest inconsistency (manifest's `input_hash` reflects the new lessons; `output_hash` reflects the reverted rules). `totem verify-manifest` then fails on push. Archive-in-place via `totem lesson archive` is the intended curation surface.

Three return conditions must ship before `totem wrap` comes back: a `--skip-docs` flag on wrap, a 24-hour git-author-date freshness guard on `totem docs`, and an end-to-end regression test that seeds a hand-crafted `active_work.md` and asserts the file survives the pipeline unmodified.

### `totem add-secret <value>`

Adds a user-defined secret to the local DLP pipeline (`.totem/secrets.json`). Secrets are automatically masked during lesson ingestion and shield reviews.

- **Flags:**
  - `--pattern`: Treat the value as a regex pattern instead of a literal string. Patterns are validated for syntax and **ReDoS safety**. Catastrophic backtracking patterns like `(a+)+$` are rejected at input time.

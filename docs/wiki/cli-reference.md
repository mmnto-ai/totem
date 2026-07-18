# CLI Command Reference

This document provides a detailed breakdown of the `totem` command-line interface.

> **Note:** All orchestrator commands (like `spec`, `triage`, and `extract`) currently require the [GitHub CLI (`gh`)](https://cli.github.com/) to be installed on your system.
>
> **Global Flags:** Every Totem command supports the `--json` flag to output structured JSON instead of human-readable text. This makes it trivial to pipe Totem into your own automation scripts or UI dashboards (e.g., `totem status --json`).

> **Standalone Binary (Totem Lite):** If you are using the compiled standalone binary (no Node.js required), commands that require the LLM orchestrator or local Vector database are excluded to keep the binary small.
>
> - **Available in Lite:** `init`, `lint`, `hooks`, `doctor`, `status`, `rule list`
> - **Excluded in Lite:** `review`, `sync`, `extract`, `spec`, `triage`, `lesson compile`, and the other orchestrator- or index-dependent commands
>
> Excluded commands are tagged `[requires full install]` in the `--help` menu and exit with status code `78` (configuration error) if invoked, prompting you to install the full Node.js package.

---

## Initialization & Setup

### `totem init`

Auto-detects your project structure, package manager, and installed AI agents. It scaffolds `totem.config.ts`, injects the Proactive Memory Reflexes into your agent's instruction files (e.g., `CLAUDE.md`, `GEMINI.md`), and automatically seeds the project with the **Universal Baseline**.

- **Flags:**
  - `--bare`: Initializes Totem in a zero-config mode optimized for non-code repositories (e.g., Markdown notes, Obsidian vaults, documentation sites). Skips Git hooks, orchestrator detection, and API key prompts, forcing the Lite tier so you can use Totem as a local MCP RAG server without developer tooling overhead.

### `totem hook` (install / run / test)

The hook engine. `totem hook install` installs or updates background git hooks (`pre-commit`, `pre-push`, `post-merge`) non-interactively and resolves the git root in monorepo sub-packages. `totem hooks` remains as a deprecated alias for `totem hook install`.

- **`hook install` flags:**
  - `--check`: Verifies the hooks are installed and exits non-zero if any are missing (no writes).
  - `-f, --force`: Overwrites existing Totem hooks. Use this after a major version upgrade.
  - `--strict`: Installs the strict enforcement tier (spec-required plus a review gate).
  - `--standard`: Installs the standard enforcement tier (default).
- **Other subcommands:** `hook run` evaluates compiled hooks against a tool-call payload (the PreToolUse runtime entrypoint); `hook test` runs hook fixtures against the compiled-hooks rules.
- **Troubleshooting (Mac/Linux):** If you clone a repository initialized on Windows and the hooks fail to fire, Git may not recognize them as executable. Fix this by running: `chmod +x .git/hooks/pre-commit .git/hooks/pre-push .git/hooks/post-merge`

### `totem config`

Displays or manages the current Totem configuration.

### `totem describe`

Outputs a structured description of the project's governance parameters for MCP and AI agent consumption.

### `totem doctor`

Runs a battery of automated health checks to verify config bloat, index health, hook wiring, and secret hygiene.

- **Flags:**
  - `--strict [tier]`: Exits non-zero when critical checks fail. `--strict=warn` also gates on warn-class diagnostics, giving CI a single machine-checkable all-wiring oracle (bare `--strict` keeps the fail-only contract).
  - `--pr`: Analyzes the Trap Ledger and downgrades rules with a >30% bypass rate, staging the changes as a GitHub Pull Request for review (the rule-tuning loop).

### `totem status` / `totem check`

`totem status` provides a high-level overview of project health (manifest, review, and rule state). `totem check` runs `totem lint` and `totem review` sequentially.

- **`check` flags:**
  - `--staged`: Only check staged changes.
  - `-m, --model <model>`: Override the orchestrator model.
  - `--fresh`: Skip the cache.

### `totem eject`

Safely removes all Totem git hooks, config files, agent prompt injections, and the local `.lancedb/` index.

### `totem link <path>`

Links a neighboring repo into this project so its rules and lessons are visible to the current workspace.

- **Flags:**
  - `--unlink`: Remove a previously linked repo.
  - `-y, --yes`: Skip the security confirmation prompt.

---

## Rules & Enforcement

### `totem lint`

Stateless, zero-LLM linting against `compiled-rules.json`. It reads the compiled constraints and evaluates your local files.

- **Flags:**
  - `--format <format>`: Output format — `text` (default, human-readable), `sarif` (SARIF 2.1.0, for the GitHub Advanced Security tab), or `json` (structured findings for scripting and automation).

Regex rules execute under a runtime timeout budget in a persistent worker thread so catastrophic-backtracking patterns (ReDoS) cannot hang the lint run. The timeout behavior is configurable via `--timeout-mode`:

- `--timeout-mode strict` (default) — any rule-file pair that exceeds the budget fails the lint run non-zero. This is the CI path.
- `--timeout-mode lenient` — skip the offending rule-file pair with a visible warning; exit code is unchanged. Useful for local iteration when a known-slow rule is under investigation.

Timeout outcomes land in `.totem/temp/telemetry.jsonl` tagged `type: 'regex-execution'` with repo-relative path redaction. This is distinct from the input-time ReDoS check on `totem add-secret --pattern` below — that rejects dangerous patterns at authoring time, while the lint-time budget enforces termination against any pattern that slips through.

For authoring patterns that pass the input-time gate, see [Regex Safety](regex-safety.md), which documents two empirically-verified safe forms for module-path-tolerant identifier matching (a class the gate makes non-obvious).

### `totem rule`

Manage your deterministic rules (Pipeline 1). Subcommands: `list`, `inspect`, `test`, `scaffold`, `promote`, `author`.

- `rule list` outputs active rules.
- `rule inspect <id>` shows rule details by hash (supports prefix matching).
- `rule test <id>` tests a rule against its inline Example Hit/Miss.
- `rule scaffold <id>` generates a test fixture skeleton for a compiled rule.
- `rule promote <hash>` flips a rule from `unverified` to active per ADR-089 (Zero-Trust Default). Pipeline 2 and Pipeline 3 LLM-generated rules ship `unverified: true` unconditionally; this command is the atomic activation surface. Supports partial hash prefixes; ambiguous prefixes print candidates and exit non-zero with no mutation. Idempotent.
- `rule author` ingests `.totem/spine/authored-rules.yaml` into authored rules and the §8 authoring-ledger (ADR-112).

### `totem gate` (check / install)

Gate engine. Evaluates decidable predicates against deterministic state.

- `gate check` evaluates a gate predicate and emits a `GateVerdict` (`allow` / `warn` / `deny`) as JSON to stdout.
- `gate install [name]` installs a gate PreToolUse hook into the committed `.claude/settings.json` (idempotent).

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

### `totem verify-manifest`

Verifies the integrity of the compiled rule manifest against current active rules (CI gate).

- **Flags:**
  - `--allow-compile-drift`: Override compile-worker fingerprint drift. In CI this requires a `## Compile Drift Justification` heading in the PR body; a pre-push run without an open PR requires the `TOTEM_DRIFT_JUSTIFICATION` env var to be set.

### `totem verify-badges`

Verifies the shields.io badges in `README.md` resolve and match project state (a deterministic claim-discipline gate).

### `totem verify-lockfile-sync`

Verifies `pnpm-lock.yaml` is in the diff range when a `package.json` adds a dependency pin (cohort-sync gate, mmnto-ai/totem#1961).

### `totem explain <hash>`

Looks up the original markdown lesson behind a deterministic rule violation. Supports partial hash prefixes. The command runs locally in milliseconds with zero LLM overhead, so a junior developer stuck on an architectural block gets an asynchronous mentor without waiting for a human reviewer.

### `totem exemption`

Manage rule exemptions for specific files or lines that deliberately bypass a structural constraint.

### `totem review`

The core of the Codebase Immune System. Reads your uncommitted diff and checks it against compiled rules and vector DB traps. Pipeline 5 observation auto-capture is off by default; opt in per invocation with `--auto-capture`.

- **Flags:**
  - Deterministic (zero-LLM) runs and SARIF/JSON export have moved to `totem lint`: use `totem lint` for a sub-3-second deterministic pass and `totem lint --format sarif` / `totem lint --format json` to export findings. (`totem review --deterministic` and `totem review --format` were removed; the CLI redirects deterministic runs to `totem lint` and errors on `--format` with the same guidance.)
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

Checks lessons for stale file references (a CI gate). Flags lessons whose scoped paths no longer exist in the tree so the knowledge base stays anchored to the current codebase.

---

## Memory & Synchronization

### `totem sync`

Parses your codebase, chunks the AST, and builds the local LanceDB vector index.

- **Flags:**
  - `--incremental`: (Default) Only indexes files changed since the last sync.
  - `--full`: Drops the existing index and rebuilds it entirely from scratch.
  - `--prune`: Interactively detects and removes stale lessons that reference deleted files.
  - `--packs-only`: Run only the deterministic pack manifest write (no API key required); skips embedding sync, prune, and the global registry update.
  - `--index-only`: Run only the embedding sync; skip the pack manifest write.
  - `-q, --quiet`: Suppress output (for background or hook usage).

### `totem search <query>`

Searches the local knowledge index for lessons, code snippets, or rules relevant to a query.

- **Flags:**
  - `-t, --type <type>`: Filter by content type (`code`, `session_log`, `spec`).
  - `-n, --max-results <n>`: Maximum results to return (default: 5).

### `totem stats`

Displays statistics about the vector index, rule bypass rates, and lesson counts.

- **Flags:**
  - `--pattern-recurrence`: Cluster bot-review findings and trap-ledger overrides across the most recent merged PRs and write `.totem/recurrence-stats.json`. Requires the GitHub CLI (`gh`) authenticated against the current repo.
  - `--threshold <n>`: Recurrence mode: minimum occurrences for a pattern to land in the headline output (default: 5).
  - `--history-depth <n>`: Recurrence mode: number of recent merged PRs to scan (default: 50, capped at 200).
  - `--yes`: Recurrence mode: auto-confirm overwrite when an existing `recurrence-stats.json` is newer.

### `totem lesson add <text>`

Adds a lesson to project memory as a markdown file under `.totem/lessons/`. `totem add-lesson` remains as a deprecated alias.

### `totem lesson list`

Lists all lessons with their hash, heading, and tags.

### `totem lint-lessons`

Validates lesson metadata (patterns, scopes, severity) before compilation.

- **Flags:**
  - `--strict`: Promote warnings to errors (exit non-zero on any diagnostic).

### `totem lesson compile`

Compiles `.totem/lessons.md` and `.totem/lessons/*.md` into deterministic regex / AST rules for zero-LLM checks. Outputs to `compiled-rules.json`. Supports Pipeline 2 (LLM-generated) and Pipeline 3 (Example-based compilation). Local compile routes to the configured orchestrator model (scaffolded default: Claude Sonnet 5).

> **Note:** `totem compile` is a deprecated alias for `totem lesson compile`. The CLI's own `--help` output marks it as deprecated. New documentation should use the entity-grouped form (`totem lesson compile`); the `totem --help` `Entities:` section lists `rule`, `lesson`, `exemption`, `config` as the canonical command groupings.

- **Flags:**
  - `--cloud <url>`: Offloads the compilation process to a cloud endpoint for parallel fan-out. (Note: Cloud compile stays Gemini-only — the migration to Claude was considered and declined ([mmnto-ai/totem#1221](https://github.com/mmnto-ai/totem/issues/1221), closed not-planned); local compile is the golden path.)
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

Fetches open GitHub issues and generates a prioritized roadmap. Ideal for planning your next task.

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

Extracts systemic lessons from resolved bot review comments on a merged PR. The input half of the extract → compile → enforce loop.

### `totem spec <issue-ids...>`

Fetches GitHub Issues and synthesizes a pre-work spec. Injects a prior art concierge (shared helper registry) enriched by your project's vector DB lessons to prevent hallucinations.

### `totem handoff`

Captures uncommitted changes and lessons learned today for your next session.

- **Flags:**
  - `--lite`: An ANSI-sanitized, zero-LLM snapshot (fast).

### `totem orient`

Derives session orientation from repo primitives (open PRs, issues, board state, freeze status) with zero LLM calls.

- **Flags:**
  - `--json`: Output the `OrientReport` as structured JSON.
  - `--session`: Emit the bounded session-orientation block for a `SessionStart` hook (boot-safe; empty when nothing is high-signal).

### `totem docs [paths...]`

Auto-updates registered project docs using LLM synthesis. Requires a configured LLM provider.

- **Flags:**
  - `--raw`: Output the assembled prompt without LLM synthesis.
  - `--out <path>`: Write output to a file instead of stdout.
  - `--model <name>`: Override the default orchestrator model.
  - `--fresh`: Bypass the cache and force a fresh LLM call.
  - `--only <names>`: Comma-separated filter that restricts synthesis to the named docs (e.g., `--only readme`).
  - `--dry-run`: Preview changes without writing files.
  - `--yes`: Skip the confirmation prompt (for scripts and CI).

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

### `totem list-secrets`

Lists all configured custom secrets (shared and local) with source labels.

### `totem remove-secret <index>`

Removes a custom secret from `.totem/secrets.json` by index (the index printed by `totem list-secrets`).

---

## Governance Records

### `totem adr new <title>`

Scaffolds a new NNN-prefixed Architecture Decision Record under `adr/` with the heading `# ADR NNN: Title`.

### `totem proposal new <title>`

Scaffolds a new NNN-prefixed governance proposal under `proposals/active/`.

---

## Cross-Repo Coordination (ECL)

### `totem mail` (send / reply / mark)

Shows unread cross-repo mail addressed to this repo's agent(s) (ADR-106 § 3). Subcommands compose and mark dispatches.

- **Flags (`mail`):**
  - `--json`: Emit JSON to stdout instead of human-readable text to stderr.
  - `--recursive`: Walk the workspace recursively for nested layouts (default: single-level siblings).
  - `--workspace <path>`: Workspace dir to scan (default: `$TOTEM_WORKSPACE`, else the parent of the current directory).
- **Subcommands:**
  - `mail send` composes and writes a validated ADR-098 dispatch to your outbox.
  - `mail reply <source>` replies to a dispatch, inferring recipient and subject from the source.
  - `mail mark <source>` marks a consumed dispatch processed in your own `processed/` cursor (consume-without-reply, ADR-106 § A1.4).

### `totem ecl-gc`

Prunes your own aged ECL outbox dispatches; with `--compact`, also compacts your processed-mark cursor. Self-resolving and dry-run unless `--apply` is passed.

- **Flags:**
  - `--apply`: Actually delete aged dispatches (default is a dry-run listing only).
  - `--retain-days <n>`: Retention window in days (default 14).
  - `--agent-id <id>`: Override the self-resolved agent whose outbox/cursor to gc (visiting or orchestrator case).
  - `--compact`: Also compact your processed-mark cursor; runs after the prune.
  - `--force-incomplete`: Unsafe. Proceed with compaction even when a declared cohort repo is absent from the workspace (waives only the roster-presence gate).
  - `--json`: Emit the structured result as JSON to stdout instead of human text.

---

## Evidence & Spine

### `totem artifact` (rerun / compare)

Inspects grounded run artifacts under `.totem/artifacts/runs/`.

- `artifact rerun <hash>` re-invokes a recorded run with its exact stored bundle and backend, emitting a new artifact.
- `artifact compare <hashA> <hashB>` produces a deterministic artifact-vs-artifact diff (structural equality plus metric deltas).

### `totem spine` (windtunnel / freeze-split)

Spine evidence harness for Gate-1 wind-tunnel evaluation.

- `spine windtunnel` freezes the corpus lock and runs the evidence harness.
- `spine freeze-split` freezes the pre-authoring split, derives the window from lc HEAD, stamps `frozenAt`, and writes the tamper-evident tracked artifact (ADR-112 §5.1/§8 R1).

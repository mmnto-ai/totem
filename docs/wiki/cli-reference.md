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

Safely removes all Totem git hooks, config files, agent prompt injections, and the local `.lancedb/` index. Before asking consent it senses the VCS state of the files it is about to touch and says which ones have no revert point — uncommitted changes, and gitignored paths (like `.totem/secrets.json`) that git holds no copy of at all (`--force` skips the prompt, not the sense lines). Git hooks live outside version control, so eject writes each hook's pre-mutation bytes to `.git/hooks/<name>.totem-bak` before touching it — if a scrub goes wrong, restore from the `.totem-bak` file. File rewrites are atomic (temp + rename): an interrupted eject leaves each rewritten file with its old or new content, never a torn mix (file and directory deletions are ordinary deletes).

- **Files eject will not modify:** any hook or agent-instruction file carrying a Totem block whose bytes don't decode as UTF-8 is reported as a skip and left byte-identical — scrubbing it would corrupt the kept content, so remove the Totem block manually.
- **Exit code:** if every reflex-file scrub attempt fails, eject still prints the full summary (the skip reasons and any `.totem-bak` recovery paths), then exits non-zero with `EJECT_FAILED`.

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
- `rule test <id>` tests a rule against its inline Example Hit/Miss; for a Prop 310 record rule it instead runs every `examples[i]` pair through the smoke gate (the `bad` side must fire, the `good` side must stay silent) and reports one line per ordinal.
- `rule scaffold <id>` generates a test fixture skeleton for a compiled rule.
- `rule promote <hash>` flips a rule from `unverified` to active per ADR-089 (Zero-Trust Default). Pipeline 2 and Pipeline 3 LLM-generated rules ship `unverified: true` unconditionally; this command is the atomic activation surface. Supports partial hash prefixes; ambiguous prefixes print candidates and exit non-zero with no mutation. Idempotent.
- `rule author` ingests `.totem/spine/authored-rules.yaml` into authored rules and the §8 authoring-ledger (ADR-112); each entry references its rule as a `.totem/rules/<slug>.rule.yaml` record rather than carrying the matcher inline (Prop 310).

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

The manifest also attests `.totem/rules/**/*.rule.yaml` as `records_hash` over the git-tracked records (untracked drafts are neither hashed nor counted); an absent `records_hash` is accepted only while no tracked record exists, and a mismatch is never downgraded by an active freeze.

- **Flags:**
  - `--allow-compile-drift`: Override compile-worker fingerprint drift. In CI this requires a `## Compile Drift Justification` heading in the PR body; a pre-push run without an open PR requires the `TOTEM_DRIFT_JUSTIFICATION` env var to be set.

### `totem verify-badges`

Verifies the shields.io badges in `README.md` resolve and match project state (a deterministic claim-discipline gate).

### `totem verify-lockfile-sync`

Two deterministic checks on the branch-vs-base diff (cohort-sync gate, mmnto-ai/totem#1961). Zero network; git reads only.

1. **Missing lockfile:** fails when a `package.json` adds a dependency pin but `pnpm-lock.yaml` is absent from the diff range.
2. **Silent pin removal:** fails when the diff removes every lockfile entry for a package that a workspace manifest still declares (declarations are read from the lockfile's own `importers:` set — plus `pnpm-workspace.yaml` coverage for manifests added on the branch — so tracked non-workspace manifests such as test fixtures never trigger it). This catches a real `pnpm` hazard: a failed fetch of an `optionalDependencies` entry (for example, an expired registry token for a restricted package) makes `pnpm install` silently drop the package's lockfile entries while exiting 0 — and because the resulting lockfile is internally consistent, `--frozen-lockfile` CI installs pass it. Recovery: verify registry auth with `npm whoami`, regenerate with `pnpm update <pkg>` (`pnpm install --lockfile-only` false-reports "Already up to date" on optional-dependency drops), and commit the regenerated lockfile.

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
  - `--gate`: The wiring's declared disposition→exit mapping (ADR-109's wrapper role — the CLI states verdicts, the flag maps them; used by the managed pre-push hook). Known `not-applicable` admissions and completed rounds exit `0` (findings are report-only in hook context), hard failures exit non-zero, and an unknown disposition fails **closed** — the one exit-semantic difference from the bare sensor default. Contradictory with `--fail-on`.
  - `--covariate`: Read-only, zero-LLM transport. Resolves the current review state and prints the canonical `local-lane:` line to stdout — the latest verdict artifact for the lineage when the current diff is admitted, or the exact-identity admission record when it is not-applicable. Always exits `0`; writes nothing.

#### Admission phase and deterministic skips (mmnto-ai/totem#2473)

Applicability is decided before any lane is configured. A diff that resolves to nothing reviewable — `no-diff`, `all-non-code`, `filtered-empty`, or `all-generated` — is a **`not-applicable` admission verdict**, never a lane outcome: the run prints one calm disposition line, writes a machine-readable admission record to `.totem/artifacts/admissions/` (content-addressed; it binds the resolved diff scope, a hash of the diff bytes, and a fingerprint of the effective selection policy), and exits `0`. **No deterministic skip stamps the push-gate cache** — including the former clean-tree "trivial pass," which previously refreshed `.reviewed-content-hash` for a tree no reviewer saw. Prose being outside the gate is a coverage decision, stated by the disposition — never evidence that prose was reviewed.

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
  - `--full`: Drops the existing index and rebuilds it entirely from scratch. If a
    previous full re-index was interrupted, this resumes it instead — see
    **Crash recovery** below for the restart escape hatch.
  - `--prune`: Interactively detects and removes stale lessons that reference deleted files.
  - `--packs-only`: Run only the deterministic pack manifest write (no API key required); skips embedding sync, prune, and the global registry update.
  - `--index-only`: Run only the embedding sync; skip the pack manifest write.
  - `-q, --quiet`: Suppress output (for background or hook usage).

- **Crash recovery (mmnto-ai/totem#2562):** a full re-index checkpoints its
  progress per file (`.totem/cache/full-sync-checkpoint.json`). If the run is
  interrupted (e.g. an embedding-quota 429), the **next `totem sync` — plain or
  `--full` — resumes from the checkpoint** instead of reporting a false
  "complete" over the partial index or re-spending quota on already-embedded
  files. The checkpoint is verified against the store itself before it is
  trusted — files no longer present in the index re-embed regardless of what
  the checkpoint claims. Files that moved since the interrupted run started
  are re-embedded: anything in git's tracked diff since the epoch, plus
  anything whose modification time postdates the epoch start (the only signal
  for untracked files and non-git projects; a restore tool that preserves old
  mtimes can defeat this arm — delete the checkpoint to force a full restart).
  Chunks of files deleted in the meantime are purged by the next incremental
  reconciliation. While a checkpoint is live, EVERY sync (including the
  incremental syncs commands like `lesson extract` run internally) is promoted
  to the resume — an incremental pass over a partial index cannot be trusted,
  so completing the epoch comes first. Delete the checkpoint file to force a
  restart from scratch. Progress is discarded (with a loud log) if the
  checkpoint is unreadable or if the embedder identity that will actually
  serve this run differs from the one that served the epoch — the checkpoint
  records the EFFECTIVE identity, so a silent Ollama fallback restarts
  instead of mixing vector spaces, while a persistent fallback resumes as
  itself (a resume with nothing left to embed clears the marker without
  needing an embedder — unless the embedder resolves to a DIFFERENT identity
  than the epoch's, which still restarts). Gemini ingest embeds are paced by
  default (4s between multi-text batches, derived from the default 2,000/min
  per-minute quota window; query embeds are never paced), so with no quota
  configuration at all a re-index completes instead of dying at ~2k chunks —
  a few minutes for a few-thousand-chunk corpus, proportionally longer for
  larger ones; tune or disable via
  `embedding.throttleMs`. Note the pacing makes a full re-index take minutes
  on large corpora — bounded-budget callers should check for a live
  checkpoint rather than racing it (the MCP `add_lesson` tool defers its
  convenience sync for exactly this reason).

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

Categorized bot review triage. Fetches CodeRabbit, GCA, Greptile, and `github-code-quality[bot]` comments, heuristically maps their severities, and groups them by impact to prevent alert fatigue. (`github-code-quality[bot]` has no known @-listener, so disposition comments are audit-trail-only for it; its findings carry no native severity vocabulary — they surface as `info` and are categorized by body keywords, where boundary-anchored matching applies to the NITS bucket only; security/architecture/convention keep their long-standing substring matching.)

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

### `totem spec [inputs...]`

Fetches GitHub Issues (or takes free-text topics) and synthesizes a pre-work spec. Injects a prior art concierge (shared helper registry) enriched by your project's vector DB lessons to prevent hallucinations.

Inputs are OPTIONAL because `--from <record>` is an alternative subject. Running `totem spec` with neither inputs nor `--from` is an error naming the usage line.

- **Flags:**
  - `--from <record>`: Ground the run on a hand-authored design record. The LLM still runs — the record and the retrieved context are its input — but the RECORD is the anchor (repo-relative path plus the sha256 of the bytes rendered into the prompt) and the record is **never written**. The draft goes to `--stdout` or `--out`; with neither it goes to stdout, because a record derives no default path. `--out` resolving to the record itself is refused, as are a missing, unreadable, empty or whitespace-only record, `--from` combined with positional inputs, and **a record outside the git root the command runs in** (outside a git repo, the root is the cwd) — the bound ref is stored repo-relative and the pre-commit gate resolves it from the worktree top, so a record it cannot reach from there is not a binding. A cohort seat binding a record from a sibling checkout (`--from ../other-repo/design.md`) is therefore refused: copy the record into this repo, or reference it from a record that lives here.
  - `--raw`: Output the retrieved context without LLM synthesis (no artifact is written).
  - `--out <path>`: Write the draft to a specific file.
  - `--stdout`: Print the draft to standard output (mutually exclusive with `--out`).
  - `--model <name>`: Override the default orchestrator model.
  - `--fresh`: Bypass the cache and force a fresh LLM call.

#### The unanchored-topic refusal

Every run publishes what it was ANCHORED on, in `grounding.anchor.kind` of the run artifact: `issue` (every input resolved to an issue), `record` (`--from`), `free-text` (every input was a topic), or `mixed` (issues and topics together).

A run with **no issue and no record** refuses when retrieval returns zero items, or — only when `searchRelevanceFloor` is configured — when the best relevance of the retrieval is below it and no floor-exempt (keyword-only) hit exists. The error names the topic, the measurement, the floor's value and its place, and every withheld candidate.

`searchRelevanceFloor` carries **no default** (mmnto-ai/totem#2727), so with the key unset only the zero-hit arm can fire, and the floor line says so rather than naming a number no run was judged against:

```text
[Totem Error] Refusing to draft an unanchored spec for topic(s): an-unanchored-slug.
Retrieval returned 0 hits — nothing in the index grounds this run.
floor none — searchRelevanceFloor unset in totem.config.ts (no default; calibrate per repo — see config-reference)
```

Lessons are retrieved but do not ground a run, so a topic that matched only lessons still refuses. When that happens the refusal names them, so the count line above it (`Found: … N lessons`) does not read as a contradiction. Here with a floor configured:

```text
[Totem Error] Refusing to draft an unanchored spec for topic(s): an-unanchored-slug.
Retrieval returned 0 grounding hits (specs, sessions, code) — nothing in the index grounds this run.
3 lessons were retrieved, but lessons do not ground a run (ruled mmnto-ai/totem#2727).
floor 0.570 — searchRelevanceFloor in totem.config.ts
```

The first form of the lessons clause renders when no lessons were retrieved, the second when some were; the floor line takes its `none` form or its value form independently. It exits non-zero and writes **no run artifact** — and the artifact of a run that PROCEEDS records `grounding.floor` only when a floor was configured. A free-text or mixed run that proceeds prints one warning that it is not gate evidence.

`--raw` is **exempt**: it makes no LLM call and mints nothing, so it stays the way to inspect a weak topic's retrieval before deciding how to anchor it.

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
  - `--as <seat>`: Serve exactly this seat's mail. The seat must be one this repo resolves (config / seat dirs / cohort map — or the env-declared list when those are empty); a foreign seat is refused, because its processed-marks cursor lives in its home repo and a foreign-anchored poll answers "ever addressed," never "unread." Poll-only: the flag is parent-scoped, so `mail reply` ignores it — use `mail reply --from <seat>`.
  - `--all-seats`: Serve the full multi-seat union (repo dashboard view) — bypasses the identity gate by name.
- **Identity gate (multi-seat repos):** an identity-less poll (no per-shell `TOTEM_SELF_AGENT`, no `--as`) in a repo that resolves more than one seat serves **broadcast mail only** — directed mail is withheld as a count and the poll exits `2` until identity is explicit. Reading never consumes: `mail mark` is the single-writer mark actuator (ADR-106 § A1.3).
- **Exit codes:** `0` — verdict derived. `2` — NOT DERIVED (no self agent resolved, or an identity-gated poll): fix identity and re-poll. `4` — SENDER FAULT (mmnto-ai/totem#2685): the verdict IS derived and rendered, but an outbox this repo hosts for a resolved seat carries a dispatch whose `to:` matches no roster agent — undeliverable to every seat-scoped poll (`to:` is single-valued per ADR-098; a comma list is refused by `mail send` and faults when hand-written). Rendered as an `Error:` line and as a structured `senderFaults[]` entry under `--json`; fix the `to:` and re-poll. A foreign repo's undeliverable dispatch stays a `Warning:`. `2` wins over `4` when both hold. Like a gated poll's warnings, an `Error:` line names a dispatch basename — propagate nothing from it.
- **Subcommands:**
  - `mail send` composes and writes a validated ADR-098 dispatch to your outbox.
  - `mail reply <source>` replies to a dispatch, inferring recipient and subject from the source.
  - `mail mark <source>` marks a consumed dispatch processed in your own `processed/` cursor (consume-without-reply, ADR-106 § A1.4).

### `totem seat` (add / suspend / remove / list)

Declared seat lifecycle (`active | suspended | retired`) as a per-seat marker at
`.totem/orchestration/<seat>/lifecycle.json` (mmnto-ai/totem#2511). Lifecycle is declared and
operator-driven; session state (`LIVE/IDLE/FAULTED`) is derived downstream and is a different axis.
A seat with no marker is `active` — existing trees are unaffected. Lifecycle transitions never
discharge obligation edges and never delete data (retention is a separate contract).

- **Subcommands:**
  - `seat add <seat-id>` wires the birth checklist: the three orchestration subdirs, an `active`
    marker (`by` recorded from a single-seat `TOTEM_SELF_AGENT` when set; honestly absent when the
    env is unset or lists multiple seats), the `host_agents` handling in
    `.totem/orchestration/config.json` (appended preserving every existing entry where the key
    exists; a config without the key is left byte-identical and reported; no config is ever
    created where absent), and the emitted propagation checklist for surfaces the verb cannot reach
    (vendor poll wiring, external registries, seat-roster tables). `--reactivate` transitions an
    existing `suspended` seat back to `active`; a `retired` seat is never resurrected.
  - `seat suspend <seat-id> [--reason <text>]` marks the seat `suspended`: it leaves broadcast
    required-sets and round denominators but keeps its directed-mail visibility. `--reason` is
    encouraged — it becomes the recorded-ruling audit trail.
  - `seat remove <seat-id> [--reason <text>]` marks the seat `retired` and emits the
    deregistration checklist. Nothing is deleted.
  - `seat list [--json]` renders the derived seat-state table (seat · state · since · source) with
    any degraded-marker warnings.

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

### `totem legs` (deposit / gate)

The two verbs over the falsification-leg deposit store under `<totemDir>/artifacts/legs/`. A **deposit** is the machine-readable record a review leg leaves behind after it READ a diff: the head it read (`diffSha`), when it read it (`readAt`), its typed findings, which of them the seat folded, and its one-line verdict. The gate's question is narrow and it is the only one either verb answers — _was this head read by a leg?_

`totem legs deposit --sha <ref> --from <file> [--replace] [--read-at <iso>]` is the single writer.

- `--from <file>` (required): the leg's findings JSON. Each finding carries `id` (unique, `[A-Za-z0-9_-]{1,32}`), `severity` (`BLOCKING` | `MATERIAL` | `MINOR`), `file`, `line`, `claim` and `counterexample`; `folded` may only name ids that exist in `findings`.
- `--sha <ref>` (default `HEAD`): the head the leg read, resolved through `git rev-parse --verify <ref>^{commit}`. A ref that is not a commit in this repository is refused by name, and a file whose own `diffSha` disagrees with the resolved sha is refused naming both — a deposit must name the head it read.
- `--replace`: overwrite an existing deposit for this sha. Without it an occupied address is refused, carrying the incumbent's `readAt`; with it, the replaced instant is printed.
- `--read-at <iso>`: the leg's own instant. Absent from both the flag and the file, `now` is stamped and the substitution is printed (`readAt defaulted to … — pass --read-at for the leg's own instant`), because ties between deposits are broken on it.

The write is validated before the filesystem is touched, so a refused deposit leaves no file and no temp behind; a schema violation is reported with its path (`findings.0.severity`, `folded.0`). On success the stored path is printed with `blocking=N material=N minor=N folded=N`.

`totem legs gate [--advisory]` is the reader the managed pre-push hook calls. It judges `HEAD` and only `HEAD` — there is deliberately no flag for choosing another, because a caller-chosen head turns a block into a pass (a deposit written on a sibling branch answers for a commit the push does not contain). It writes nothing, and it never judges a finding's severity or disposition — the floor is that a leg read this diff.

- **Exit vocabulary:** `0` the push is not legs-owed, or a deposit answers for its head · `3` the push is legs-owed and no deposit answers · `2` the gate could not derive (not a git repo, an unresolvable head, a branch diff that will not resolve).
- `--advisory`: print the byte-identical lines of every state and exit `0` for every GATE state (not owed, evidence, blocked, not derived). A failure BEFORE the derivation — an unloadable config, an unknown flag — still exits non-zero through the CLI's error boundary. The tier changes the gate's exit code and nothing else.

A push is legs-owed when a changed path in the branch-vs-base diff matches `hooks.legsOwed.globs`. That diff is resolved UNFILTERED — `ignorePatterns` and `shieldIgnorePatterns` never hide a path from the floor, and the `[Legs] Diff source:` line says so. Not owed prints what it judged against and never consults the store:

```text
[Totem] legs: not owed — no changed path matched hooks.legsOwed.globs (7 globs; head 4f21ab90)
```

A deposit answers for its own head and for every descendant of it (ancestor-or-equal), with the exact read outranking the nearest ancestor — and, for an ancestor, only when it COVERS at least one of the owed paths (the branch diff up to its own head, intersected with what this push owes). The pass line carries the read's age, how far the head has moved since, and how much of the owed set that read could have seen, so a stale-but-valid pass is visible rather than silent:

```text
[Totem] legs evidence: .totem/artifacts/legs/b7d3e0a1f4c25e6890ab3d71c0e4f2a8b95d6c37.json (read 2026-09-02T04:00:00.000Z, 1 days old) · head 4f21ab90 · nearest ancestor, +3 commits since the leg read · covers 2/3 owed paths · blocking=2 material=1 folded=3
```

Owed with nothing fresh names the basis — which glob matched which file — plus every stale candidate with its own reason, and the cure:

```text
[Totem] BLOCKED: this push is legs-owed (docs/wiki/** → docs/wiki/enforcement-model.md, .changeset/** → .changeset/five-cats-smile.md) and carries no fresh falsification-leg deposit for head 4f21ab90
[Totem] legs: stale deposit 9c02be71: not an ancestor of head
[Totem] legs: stale deposit 51ba07cc: covers none of the owed paths (the deposit predates every owed change)
[Totem] legs: run the leg, then: totem legs deposit --sha HEAD --from <findings.json>
```

A candidate is stale for one of three reasons, each named because each has a different repair: it names no commit here (`unknown to this repo` — fetch the history), it is not an ancestor of HEAD (`not an ancestor of head` — deposit against this branch), or it covers none of the owed paths (`covers none of the owed paths` — run the leg over the diff this push proposes). `covers K/N` on a passing line is disclosure only: a leg that read some of what this push owes still read this head, and re-arming after a fold is doctrine's rule, not the gate's.

A deposit file that is unreadable, not JSON, schema-invalid, or named for a sha other than the one it stores is a per-file sensor row on stderr (`[Totem] legs: sensor — ignoring corrupt deposit <file>: <reason>`). It never counts as evidence and never masks a valid sibling.

**Covariate.** Since format **v1.2** the `local-lane:` line `totem review --covariate` prints carries a `leg:` field: `leg: <sha8> blocking=N material=N folded=N` when a deposit answers for the checkout's `HEAD` — the deposit is resolved against HEAD, not against the review lineage — and `leg: none` when none does (including when `HEAD` itself does not resolve, and when HEAD has no branch base for coverage to be measured against — announced as one sensor line, never a name resolved on ancestry alone). The coverage inputs come from HEAD's OWN branch scope whatever scope the review ran on, so the field can never name a deposit `totem legs gate` would reject; the cost is that `--covariate` resolves that branch diff a second time, quietly. When no verdict and no admission record exists for the lineage but a deposit does, the line renders as `local-lane: none leg: <sha8> …`, so a diff is never presented with no evidence line at all. A folded finding is counted in BOTH its severity bucket and in `folded`, so `blocking=3 folded=3` reads "all three were addressed" and `blocking=3 folded=0` reads "none were". The v1 shapes before the field are byte-unchanged; consumers keep discriminating on the second token.

### `totem spine` (windtunnel / freeze-split)

Spine evidence harness for Gate-1 wind-tunnel evaluation.

- `spine windtunnel` freezes the corpus lock and runs the evidence harness.
- `spine freeze-split` freezes the pre-authoring split, derives the window from lc HEAD, stamps `frozenAt`, and writes the tamper-evident tracked artifact (ADR-112 §5.1/§8 R1).

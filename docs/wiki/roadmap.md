# Totem Strategic Roadmap

Totem is a **standard library for codebase governance** — zero-telemetry infrastructure that prevents AI coding agents from violating architectural boundaries. It provides sensors (lint rules, vector search, compiled patterns); users wire the actuators (Git hooks, CI, MCP boundaries).

---

## Active: 1.11.0 — The Import Engine

_Rule portability — bring governance from external tools and other totem instances._

- **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.
- **Rule Refinement (#1131):** Refine rules from false-positive scan alerts.
- **AST Upgrade Detection (#1132):** Auto-detect string-content matches for AST patterns.
- **Pack Distribution (#1059):** Shareable rule bundles.
- **Proactive Language Packs (#1152):** Thick TypeScript/Shell/Node.js baseline rules from established best practices.
- **GHAS/SARIF Extraction (Strategy #50):** Import from GitHub Advanced Security alerts.
- **Lint Warning Extraction (Strategy #51):** Convert lint warnings into totem lessons.

---

## Next: 1.12.0 — Foundation & Validation

_Internal quality, research validation, and platform hardening._

- **Orchestrator Refactor (#999):** Decompose runOrchestrator into middleware pipeline.
- **Path Registry (#997):** Centralize path resolution via WorkspaceContext.
- **Non-Null Sweep (#1000):** Replace `!` assertions with proper type narrowing.
- **git.ts Compat Review (#1008):** Re-export backward compat on error paths.
- **Shield Tests (#1020):** Exercise shieldCommand directly in validation tests.
- **Concurrent Dispatch (#1053):** Parallel agent task execution.
- **Docs Scope (#1033):** Fix `totem wrap` doc sync reliability.
- **Trap Corpus (Strategy #6):** Adversarial eval suite for deterministic engine.
- **Eval Harness (Strategy #17):** Governance eval tooling.
- **Model Adapters (Strategy #62):** Model-specific prompt tuning.
- **Spec Efficacy (Strategy #63):** Proving agent followed the spec.

---

## Shipped

### 1.11.0 — The Import Engine (2026-04-04)

_Rule portability — bring governance from external tools and other totem instances._

- **Proactive Language Packs (#1152):** Thick TypeScript/Shell/Node.js baseline rules (50 total) from established best practices like @typescript-eslint/strict, OWASP Node.js, and ShellCheck/POSIX.
- **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.

### 1.10.2 — Phase 2: Import Engine Foundations (2026-04-04)

_Retirement ledger, compiler safety, and expanded ESLint import coverage._

- **Lesson Retirement Ledger (#1165):** `.totem/retired-lessons.json` tracks intentionally removed rules, preventing re-extraction. Integrated into the extraction pipeline.
- **Compiler Guard (#1177):** Rejects rules whose patterns match suppression directives (totem-ignore, totem-context, shield-context) — they self-suppress at runtime.
- **ESLint Syntax/Properties (#1140):** `totem import --from-eslint` now handles `no-restricted-properties` (dot, optional chaining, bracket notation) and `no-restricted-syntax` (ForInStatement, WithStatement, DebuggerStatement).
- **Model Defaults (#1185):** `totem init` defaults updated to `claude-sonnet-4-6` (Anthropic) and `gpt-5.4-mini` (OpenAI).

### 1.10.1 — Phase 1 Bug Fixes (2026-04-04)

_Rule hygiene and release pipeline hardening before the Import Engine._

- **Exemption Dedup (#1158):** Added `!includes(message)` check in `recordFalsePositive()`.
- **Exit Scope (#1164):** Narrowed process.exit() rule to exclude CLI entry points and command files.
- **Rule Conflict Audit (#1166):** Deleted 5 lessons, scoped 1 (418 → 413 compiled rules).
- **POSIX Compliance (#1168):** Multi-line if/then/fi in agent detection, hardened hook parser.

### 1.10.0 — The Invisible Exoskeleton (2026-04-02)

_Reduce adoption friction so totem disappears into the developer's workflow._

- **Pilot Mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes).
- **Enforcement Tiers (#987):** Strict tier + agent auto-detection via environment variables.
- **.env Parser (#1114):** Hardened with dotenv.
- **Spec Infrastructure (#1016):** Query expansion for test keywords + docstring enrichment.
- **Solo Dev Experience (#1039):** `extract --local` for local git diffs. Global profile (`~/.totem/`) with `totem init --global`.
- **"Missed Caught" Audit (#1153):** Historical bot findings categorized by detection tier (44% deterministic).
- **Manifest Rehash (#1155):** Observation capture re-hashes compile manifest after mutation.
- **Pre-Push Format Check (#1156):** Package-manager-agnostic `format:check` in hook template.
- **Extract Refactor (#1159):** Split extract.ts into per-mode modules with unified assembler.
- **Exit Code Fix (#1161):** `--yes` mode sets exitCode 1 when all lessons suspicious.

### 1.9.0 — Pipeline Engine (2026-04-01)

_Five pipelines for rule creation, from zero-LLM to fully autonomous._

- **P1 — Manual Scaffolding:** `totem rule scaffold` with auto-generated test fixtures.
- **P2 — LLM-Generated:** `totem compile` converts prose lessons to regex patterns.
- **P3 — Example-Based:** Bad/Good code snippets compiled with self-verification via `testRule`.
- **P4 — Import:** `totem import` translates ESLint/Semgrep configs. Zero LLM cost.
- **P5 — Observation Auto-Capture:** Shield findings automatically staged as warning-severity rules.
- Pre-compiled baseline rules for Python, Rust, and Go. Scan feedback loop from GHAS alerts. Shield auto-learn on FAIL verdicts.

See [Pipeline Engine](pipeline-engine.md) for full details.

### 1.7.0 — Platform of Primitives (2026-03-29)

- **CLI Redesign:** Noun-verb taxonomy, global `--json` output, redesigned help.
- **Actor-Aware Enforcement (ADR-083):** Stateless Git hooks. Content Hash Lock at the MCP boundary.
- **Agent Context Engineering:** SessionStart Auto-Context V2 (vector/FTS), `totem describe`, structured handoff checkpoints.
- **Rule Lifecycle:** Garbage collection with adaptive decay, compile progress with 429 retry.

### 1.6.0 — Pipeline Maturity (2026-03-22)

- Self-healing loop: Trap Ledger, exemption engine, bot review signal capture.
- Inline rule unit testing, standard library, forbidden native module rules.
- Compiler DX, shield flag auto-refresh, stress testing.

### Earlier (1.0–1.5)

- Local vector engine (LanceDB), MCP interface, adversarial hardening.
- Severity levels and SARIF output, multi-domain MCP isolation.
- Rule lifecycle telemetry, autonomous downgrading, triage inbox.
- `totem doctor`, consumer init with agent auto-detection.

---

## Future: 2.0 — Federation

_Multi-repo coordination for teams running autonomous agents at scale._

- **Federated Rules:** Central strategy repo pushes compiled rules to downstream repos via RBAC.
- **Signed Trap Ledger:** Cryptographically signed, immutable cloud endpoint.
- **Compliance Dashboard:** Override rates, rule health trends, bypass audit trails.
- **Mesh Export:** Portable bundle format for lessons and rules.

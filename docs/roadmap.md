# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a **standard library for codebase governance** — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the progression from enforcement primitives to multi-repo federation.

---

## 1.11.0 — The Import Engine (Active)

**Theme:** Rule portability — bring governance from external tools and other totem instances.

- [ ] **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- [ ] **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.
- [ ] **Rule Refinement (#1131):** Refine rules from false-positive scan alerts.
- [ ] **AST Upgrade Detection (#1132):** Auto-detect string-content matches eligible for AST patterns.
- [ ] **Pack Distribution (#1059):** Shareable rule bundles.
- [ ] **Proactive Language Packs (#1152):** Thick TypeScript/Shell/Node.js baseline rules from established best practices (moved from 1.10.0).
- [ ] **GHAS/SARIF Extraction (Strategy #50):** Import rules from GitHub Advanced Security alerts.
- [ ] **Lint Warning Extraction (Strategy #51):** Convert lint warnings into totem lessons.

---

## 1.12.0 — Foundation & Validation (Next)

**Theme:** Internal quality, research validation, and platform hardening.

- [ ] **Orchestrator Refactor (#999):** Decompose runOrchestrator into middleware pipeline.
- [ ] **Path Registry (#997):** Centralize path resolution via WorkspaceContext.
- [ ] **Non-Null Sweep (#1000):** Replace `!` assertions with proper type narrowing.
- [ ] **git.ts Compat Review (#1008):** Re-export backward compat on error paths.
- [ ] **Shield Tests (#1020):** Exercise shieldCommand directly in validation tests.
- [ ] **Concurrent Dispatch (#1053):** Parallel agent task execution (moved from 1.10.0).
- [ ] **Docs Scope (#1033):** Fix `totem wrap` doc sync reliability (moved from 1.10.0).
- [ ] **Trap Corpus (Strategy #6):** Adversarial eval suite for deterministic engine.
- [ ] **Eval Harness (Strategy #17):** Governance eval tooling.
- [ ] **Model Adapters (Strategy #62):** Model-specific prompt tuning (moved from 1.10.0).
- [ ] **Spec Efficacy (Strategy #63):** Proving agent followed the spec.

---

## Shipped Milestones

### 1.11.0 — The Import Engine (2026-04-04)

**Theme:** Rule portability — bring governance from external tools and other totem instances.

- [x] **Proactive Language Packs (#1152):** Thick TypeScript/Shell/Node.js baseline rules (50 total) from established best practices like @typescript-eslint/strict, OWASP Node.js, and ShellCheck/POSIX.
- [x] **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- [x] **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.

### 1.10.2 — Phase 2: Import Engine Foundations (2026-04-04)

**Theme:** Retirement ledger, compiler safety, and expanded ESLint import coverage.

- [x] **Lesson Retirement Ledger (#1165):** `.totem/retired-lessons.json` tracks removed rules, preventing re-extraction.
- [x] **Compiler Guard (#1177):** Rejects self-suppressing patterns (totem-ignore, totem-context, shield-context).
- [x] **ESLint Syntax/Properties (#1140):** `no-restricted-properties` and `no-restricted-syntax` handlers.
- [x] **Model Defaults (#1185):** `totem init` updated to `claude-sonnet-4-6` and `gpt-5.4-mini`.

### 1.10.1 — Phase 1 Bug Fixes (2026-04-04)

**Theme:** Rule hygiene and release pipeline hardening before the Import Engine.

- [x] **Exemption Dedup (#1158):** Added `!includes(message)` check in `recordFalsePositive()`.
- [x] **Exit Scope (#1164):** Narrowed process.exit() rule to exclude CLI entry points and command files.
- [x] **Rule Conflict Audit (#1166):** Deleted 5 lessons, scoped 1 (418 → 413 compiled rules).
- [x] **POSIX Compliance (#1168):** Multi-line if/then/fi in agent detection, hardened hook parser.

### 1.10.0 — The Invisible Exoskeleton (2026-04-02)

**Theme:** Reduce adoption friction for new users and solo developers.

- [x] **Pilot Mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes). State tracked in `.totem/pilot-state.json`.
- [x] **Enforcement Tiers (#987):** Strict tier with spec-completed check + shield gate. Agent auto-detection via environment variables.
- [x] **.env Parser Fix (#1114):** Replaced custom regex with `dotenv` in CLI and MCP packages.
- [x] **Spec Infrastructure (#1016):** Query expansion for test-related keywords + docstring enrichment.
- [x] **Solo Dev Experience (#1039):** `extract --local` + global profile (`~/.totem/`).
- [x] **"Missed Caught" Audit (#1153):** Historical bot findings categorized by detection tier.
- [x] **Manifest Rehash (#1155):** Observation capture re-hashes compile manifest.
- [x] **Pre-Push Format Check (#1156):** Package-manager-agnostic `format:check` in hook template.
- [x] **Extract Refactor (#1159):** Split extract.ts into per-mode modules with unified assembler.
- [x] **Exit Code Fix (#1161):** `--yes` mode sets exitCode 1 when all lessons suspicious.

### 1.9.0 — Pipeline Engine (2026-04-01)

**Theme:** Five pipelines for rule creation, from zero-LLM to fully autonomous.

- [x] **P1 — Manual Scaffolding (#854):** `totem rule scaffold` with auto-generated test fixtures.
- [x] **P2 — LLM-Generated:** `totem compile` converts prose lessons to regex patterns.
- [x] **P3 — Example-Based (#749):** Bad/Good code snippets compiled with self-verification.
- [x] **P4 — Import (#750):** `totem import` translates ESLint/Semgrep configs. Zero LLM.
- [x] **P5 — Observation Auto-Capture (#751):** Shield findings staged as warning-severity rules.
- [x] **Ecosystem:** Docs/wiki refresh, playground overhaul, pre-compiled baseline rules for Python/Rust/Go.

### 1.7.0 — Platform of Primitives (2026-03-29)

- [x] **CLI Taxonomy Redesign:** Noun-verb hierarchical restructuring. Global `--json` output.
- [x] **Actor-Aware Enforcement:** Stateless Git hooks. Content Hash Lock at MCP boundary (ADR-083).
- [x] **Agent Context Engineering:** SessionStart Auto-Context V2, `totem describe`, structured handoff checkpoints.
- [x] **Rule Lifecycle:** Garbage collection with adaptive decay, compile progress with 429 retry.

### 1.6.0 — Pipeline Maturity (2026-03-22)

- [x] **Self-Healing Loop:** Trap Ledger, exemption engine, bot review signal capture.
- [x] **Core Enforcement:** Inline rule unit testing, standard library, forbidden native module rules.
- [x] **Developer Experience:** Compiler workflows, shield flag auto-refresh, stress testing.

---

## 2.0.0 — Federation (The Enterprise Tier)

**Theme:** The COSS Covenant tier — multi-repo coordination for teams running autonomous agents at scale.

- [ ] **Multi-Repo Federation:** Central strategy repo pushes compiled rules to downstream repositories via RBAC.
- [ ] **Signed Trap Ledger:** Cryptographically signed, immutable cloud endpoint for ingestion.
- [ ] **Compliance Dashboard:** Track override rates by agent source, rule health trends, and bypass audit trails.
- [ ] **Mesh Export:** Portable bundle format for lessons and rules.
- [ ] **`totem ui`:** Local web dashboard for rule decay, hit/miss rates, and ledger history.

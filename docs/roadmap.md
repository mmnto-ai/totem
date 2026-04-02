# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a **standard library for codebase governance** — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the progression from enforcement primitives to multi-repo federation.

---

## 1.10.0 — The Invisible Exoskeleton (Active)

**Theme:** Reduce adoption friction for new users and solo developers.

- [x] **Pilot Mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes). State tracked in `.totem/pilot-state.json`.
- [x] **Enforcement Tiers (#987):** Strict tier with spec-completed check + shield gate. Agent auto-detection via environment variables.
- [x] **.env Parser Fix (#1114):** Replaced custom regex with `dotenv` in CLI and MCP packages.
- [x] **Spec Infrastructure (#1016):** Query expansion for test-related keywords + docstring enrichment.
- [ ] **Proactive Language Packs (#1152):** Ship thick TypeScript/Shell/Node.js baseline rules from established best practices (DR-57/58/59). Goal: deterministic lint catches 90% of what LLM review catches.
- [ ] **"Missed Caught" Audit (#1153):** Categorize 90 days of bot review findings by detection tier to validate language pack ROI.
- [ ] **Docs Scope (#1033):** Fix `totem wrap` doc sync reliability.
- [ ] **Concurrent Dispatch (#1053):** Parallel agent task execution.
- [ ] **Solo Dev Audit (#1039):** End-to-end experience review for single-developer repos.
- [ ] **Model-Specific Adapters (Strategy #62):** Prompt tuning per LLM provider.

---

## 1.11.0 — The Import Engine (Next)

**Theme:** Rule portability — bring governance from external tools and other totem instances.

- [ ] **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- [ ] **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.
- [ ] **ESLint Syntax/Properties (#1140):** Handle `no-restricted-syntax` and `no-restricted-properties`.
- [ ] **Rule Refinement (#1131):** Refine rules from false-positive scan alerts.
- [ ] **AST Upgrade Detection (#1132):** Auto-detect string-content matches eligible for AST patterns.
- [ ] **Pack Distribution (#1059):** Shareable rule bundles.
- [ ] **GHAS/SARIF Extraction (Strategy #50):** Import rules from GitHub Advanced Security alerts.
- [ ] **Lint Warning Extraction (Strategy #51):** Convert lint warnings into totem lessons.

---

## Shipped Milestones

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

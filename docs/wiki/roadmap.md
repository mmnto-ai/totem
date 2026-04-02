# Totem Strategic Roadmap

Totem is a **standard library for codebase governance** — zero-telemetry infrastructure that prevents AI coding agents from violating architectural boundaries. It provides sensors (lint rules, vector search, compiled patterns); users wire the actuators (Git hooks, CI, MCP boundaries).

---

## Active: 1.10.0 — The Invisible Exoskeleton

_Reduce adoption friction so totem disappears into the developer's workflow._

- ~~**Pilot Mode (#949):**~~ Time-bounded warn-only hooks (14 days / 50 pushes). Shipped.
- ~~**Enforcement Tiers (#987):**~~ Strict tier + agent auto-detection. Shipped.
- ~~**.env Parser (#1114):**~~ Hardened with dotenv. Shipped.
- ~~**Spec Infrastructure (#1016):**~~ Query expansion for test keywords. Shipped.
- **Proactive Language Packs (#1152):** Ship thick TypeScript/Shell/Node.js baseline rules sourced from `@typescript-eslint`, ShellCheck, and OWASP. Goal: `totem lint` catches 90% of what `totem review` catches.
- **"Missed Caught" Audit (#1153):** Empirical validation — categorize 90 days of bot findings by detection tier.
- **Concurrent Dispatch (#1053):** Parallel agent task execution for faster review cycles.
- **Solo Dev Audit (#1039):** End-to-end experience review for single-developer repos.
- **Docs Scope (#1033):** Fix `totem wrap` doc sync reliability.
- **Model-Specific Adapters (Strategy #62):** Prompt tuning per LLM provider.

---

## Next: 1.11.0 — The Import Engine

_Rule portability — bring governance from external tools and other totem instances._

- **ESLint Flat Config (#1138):** Import from modern ESLint flat config format.
- **Totem-to-Totem Import (#1139):** Cross-repo rule sharing between totem instances.
- **ESLint Syntax/Properties (#1140):** Handle `no-restricted-syntax` and `no-restricted-properties`.
- **Rule Refinement (#1131):** Refine rules from false-positive scan alerts.
- **AST Upgrade Detection (#1132):** Auto-detect string-content matches for AST patterns.
- **Pack Distribution (#1059):** Shareable rule bundles.
- **GHAS/SARIF Extraction (Strategy #50):** Import from GitHub Advanced Security alerts.
- **Lint Warning Extraction (Strategy #51):** Convert lint warnings into totem lessons.

---

## Shipped

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

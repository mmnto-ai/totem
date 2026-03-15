### Active Work Summary

ADR-024 Data Layer Foundation is complete and released as 0.31.0. Both PRs merged: #429 (hybrid search + Gemini embeddings) and #431 (lessons directory migration).

Post-merge sequence was aligned during a multi-agent planning session (Claude + Gemini, 2026-03-13) informed by Deep Research Brief #24 (Competitive Moat Analysis). See `.strategy/deep-research/24-competitive-moat-analysis/` for the full adversarial analysis.

### Prioritized Roadmap

**Next Up (Post-0.31.0 Sequence)**

The following sequence was determined by cross-referencing the competitive moat analysis (Brief #24) with current product pain points. Ordered by effort/impact ratio:

1. **Rule Testing Harness (ADR-022)** — New issue needed. Solves the current regex false-positive pain (experienced firsthand on PR #429). Empirically identifies which rules fail with regex, providing data-driven requirements for future AST compilation. A compiler without tests is a toy.
2. **#434 — Adversarial trap corpus** — Synthetic violations to measure precision/recall of deterministic engine.
3. **#433 — Lesson Packs prototype** — Mine 1 OSS project as proof of concept for distributable rule sets.
4. **#432 — Dynamic imports for CLI startup perf** — GCA Rule 51 follow-up. Convert static `@mmnto/totem` imports to dynamic `await import()` in command files.
5. **#92 — `totem stats` enhancement (Staff Architect visibility)** — Reframed from "telemetry dashboard" to local CLI metrics: violation history from git log, lesson coverage, rule fire counts from local JSONL. No cloud, no TUI — terminal output only for v1.0.
6. **AST Compilation Design (scope within #314)** — Driven by data from the testing harness. Design task, not immediate implementation. Transitions `totem compile` from regex-only to AST-aware rules (Tree-sitter/ast-grep) for the cases where regex is provably insufficient.

**Tier-1 Core & Shift-Left Foundation**

- #314 — Epic: The Codebase Immune System — Adaptive Agent Governance. Now explicitly scoped to include AST compilation design (item 6 above).
- #124 — Epic: Frictionless 10-Minute Init (totem init).
- #430 — Document authority modes for `totem docs` (generated vs. assisted). Fixes the workflow vulnerability where `totem docs` overwrites human-curated strategic decisions.
- #435 — Auto-extract lessons from PR review comments (`totem extract --from-pr`).

**Tier-1 UX & Documentation**

- #283 — Epic: v1.0 Documentation Site & README Minimization.
- #385 — Export compiled rules to Semgrep YAML and ESLint configs — Deferred until core governance (#314) is finalized.

**Backlog (Tier-2 / Tier-3)**

- #392 — feat: `totem review` — full codebase review powered by repomix + vectordb lessons.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Phase 4.

### Completed

- **Search & Data Layer:**
  - Delivered ADR-024 with hybrid search and Gemini embeddings (#429).
  - Migrated lessons directory to dual-read/single-write and added startup health checks for LanceStore indexes (#431, #439).
- **Core & Shift-Left Foundation:**
  - Shipped SARIF 2.1.0 output for the deterministic shield, enabling GitHub Advanced Security integration (#387, #418).
  - Delivered "Universal Lessons" baseline and refined ignore patterns for frictionless initialization (#128, #419).
  - Added git hook enforcement to block main commits, managed via a new `totem hooks` command (#310, #332).
- **Orchestration & Integrations:**
  - Implemented MCP enforcement tools that equip agents to self-correct during active work (#176, #417).
  - Resolved auto-handoff on MCP lifecycle events and integrated JetBrains Junie (#383, #371).
- **Documentation & DX:**
  - Established a dev wiki and Agent Memory Architecture guide for contributor hygiene (#447).
  - Standardized CLI help output and expanded compiled rules with telemetry fields (#358, #415).

### Blocked / Needs Input

- #175 — Epic: Multiplayer Cache Syncing (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
- #123 — Epic: Federated Memory (Mother Brain Pattern) (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).

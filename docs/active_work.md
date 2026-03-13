### Active Work Summary

ADR-024 Data Layer Foundation is complete. Both PRs merged: #429 (hybrid search + Gemini embeddings) and #431 (lessons directory migration). Releasing as 0.31.0.

Post-merge sequence was aligned during a multi-agent planning session (Claude + Gemini, 2026-03-13) informed by Deep Research Brief #24 (Competitive Moat Analysis). See `.strategy/deep-research/24-competitive-moat-analysis/` for the full adversarial analysis.

### Prioritized Roadmap

**Next Up (Post-0.31.0 Sequence)**

The following sequence was determined by cross-referencing the competitive moat analysis (Brief #24) with current product pain points. Ordered by effort/impact ratio:

1. **#387 — SARIF output for deterministic shield** — Promoted from Tier-3 backlog to Tier-1. Lowest effort, highest enterprise signal. Enables GitHub Advanced Security tab integration. CISO-facing. The `Violation[]` output is already SARIF-shaped.
2. **Rule Testing Harness (ADR-022)** — New issue needed. Solves the current regex false-positive pain (experienced firsthand on PR #429). Empirically identifies which rules fail with regex, providing data-driven requirements for future AST compilation. A compiler without tests is a toy.
3. **#434 — Adversarial trap corpus** — Synthetic violations to measure precision/recall of deterministic engine.
4. **#433 — Lesson Packs prototype** — Mine 1 OSS project as proof of concept for distributable rule sets.
5. **#432 — Dynamic imports for CLI startup perf** — GCA Rule 51 follow-up. Convert static `@mmnto/totem` imports to dynamic `await import()` in command files.
6. **#92 — `totem stats` enhancement (Staff Architect visibility)** — Reframed from "telemetry dashboard" to local CLI metrics: violation history from git log, lesson coverage, rule fire counts from local JSONL. No cloud, no TUI — terminal output only for v1.0.
7. **AST Compilation Design (scope within #314)** — Driven by data from the testing harness. Design task, not immediate implementation. Transitions `totem compile` from regex-only to AST-aware rules (Tree-sitter/ast-grep) for the cases where regex is provably insufficient.

**Tier-1 Core & Shift-Left Foundation**

- #314 — Epic: The Codebase Immune System — Adaptive Agent Governance. Now explicitly scoped to include AST compilation design (item 7 above).
- #176 — Epic: Enforcement Sidecar MCP Tools — Directly equips AI agents with the tools to self-correct during active work.
- #124 — Epic: Frictionless 10-Minute Init (totem init).
- #128 — Epic: Ship "Universal Lessons" baseline during `totem init`.
- #430 — Document authority modes for `totem docs` (generated vs. assisted). Fixes the workflow vulnerability where `totem docs` overwrites human-curated strategic decisions.
- #435 — Auto-extract lessons from PR review comments (`totem extract --from-pr`).

**Tier-1 UX & Documentation**

- #283 — Epic: v1.0 Documentation Site & README Minimization.
- #385 — Export compiled rules to Semgrep YAML and ESLint configs — Deferred until core governance (#314) is finalized.

**Backlog (Tier-2 / Tier-3)**

- #392 — feat: `totem review` — full codebase review powered by repomix + vectordb lessons.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Phase 4.

### Completed (This Cycle — 0.31.0)

- #378 + #380 — Hybrid search (FTS + vector with RRF reranking) + Gemini Embedding provider — **Merged** as PR #429.
- #428 — Lessons directory migration (dual-read/single-write) — **Merged** as PR #431.
- #364 — research: vectordb structure for multi-type knowledge retrieval at scale — **Closed.** Delivered as ADR-024.
- #379 — Add `lesson` as a ContentType for precise filtering — **Closed.** Already implemented.
- #427 — Deep research ADRs + fix ignorePatterns for consumers — **Merged.**
- #408 — Deep review followup — knowledge promotion, exports, shield fix — **Merged.**

### Blocked / Needs Input

- #383 — Auto-handoff on MCP session lifecycle events (Explicitly marked as `blocked`).
- #175 — Epic: Multiplayer Cache Syncing (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
- #123 — Epic: Federated Memory (Mothership Pattern) (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).

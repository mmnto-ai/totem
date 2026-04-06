### Active Work Summary

The project is at release `@mmnto/cli@1.12.0` (published 2026-04-05) with 2,571 tests across core, CLI, and MCP packages and 438 compiled rules. Release 1.13.0 is in progress.

### Current: 1.13.0 — The Refinement Engine

Theme: Rule refinement, AST upgrades, and compilation routing.

- **Compilation Routing (shipped):**
  - ~~Strategy **#73**~~ — Compilation quality benchmark (Gemini Pro vs gemma4:26b vs Claude Sonnet)
  - ~~**#1220**~~ — Route compile to `anthropic:claude-sonnet-4-6` (90% correctness, 2.4s avg)
  - ~~**#1210**~~ — Skip TODO scaffold fixtures in wind tunnel
  - ~~**#1211**~~ — Heading-level dedup in extract pipeline
  - ~~**#1212**~~ — Closed: local gemma4 compilation not viable (benchmark evidence)

- **Auto-Upgrade Pipeline (in progress):**
  - **#664** — AST-based empty catch detection (proof-of-concept for regex→ast-grep upgrade)
  - **#1132** — Wire context telemetry into rule metrics (code vs string vs comment match tracking)
  - **#1131** — Rule refinement suggestions from false-positive scan alerts

- **Maintenance:**
  - **#1218** — Broad `throw $ERR` ast-grep pattern needs refinement
  - **#1219** — Lazy-load compiler prompt templates
  - **#1221** — Update cloud compile worker to route through Claude Sonnet
  - **#1059** — Rule pack distribution

- **Deferred strategy research:**
  - Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
  - Strategy **#17** — Governance eval harness
  - Strategy **#6** — Adversarial trap corpus
  - Strategy **#62** — Model-specific prompt adapters (partially addressed by prompt rewrite)

### Next: 1.14.0

Theme: TBD — candidates include pack distribution (#1059), code scanning alert extraction (Strategy #50/#51), and distributing compiled rules (Strategy #35).

### Recently Completed

**1.12.0 — The Umpire & The Router (2026-04-05)**

Theme: Standalone binary, research validation, and platform hardening.

- Lite-tier standalone binary with WASM ast-grep engine
- gemma4 eval + Ollama auto-detection
- GHA injection rule scope narrowed + lazy WASM init
- Context tuning (Proposal 213 Phases 2+3)
- 23 lessons extracted, 430 compiled rules at ship

**1.11.0 — The Import Engine (2026-04-04)**

Theme: Rule portability across tools and teams.

- Proactive language packs containing 50 default rules
- ESLint flat configuration import support
- Cross-repository rule sharing via direct import

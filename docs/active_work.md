### Active Work Summary

The project is at release `@mmnto/cli@1.14.0` (published 2026-04-09, "The Nervous System Foundation") with **2,722 tests** across core, CLI, and MCP packages and **394 compiled rules**.

### Current: 1.14.1 — Hotfix Sweep & Queue Drain

Theme: Draining the technical debt queue before opening new architectural surface.

- **#1304** — `applyAstRulesToAdditions` staged content + cwd resolution bug.
- **#1305** — `lance-search` SQL backtick over-escape cleanup.
- **#1306** — AST engine test coverage audit (locking in #1304 and #1305).
- **#1309** — `totem doctor` upgrade-candidate hint + stale-manifest warning emit deprecated compile.

_Note: #1304 introduces a new callback injection for the read strategy and requires a `/preflight` v2 design-doc gate._

- **#1299** — Expand `/preflight` v2 to docs that document feature surfaces (single-file edit to SKILL.md).
- **#1302** — Document dual-hash convention in `.gemini/styleguide.md`.
- **#1298** — Shield branding cleanup.
- **#1301** — Audit `nonCompilable` lesson bodies for implementation contradictions.

### Next: 1.15.0 — The Distribution Pipeline

Theme: The Totem Pack Ecosystem. 1.14.0 proved the Nervous System (federated context + cached tokens); 1.15.0 lets teams bundle and share compiled rules across repositories via the npm registry. Headline work: #1059 + Strategy #35 + ADR-085 Totem Pack Ecosystem. Cleanup tickets bundled as operational chores along the way (see "Deferred to 1.15.0" below).

_New queued features for 1.15.x:_

- **#1307** — CLI `totem search` silently ignores `linkedIndexes`.
- **#1308** — `totem doctor` has no Linked Indexes health check.

- **Deferred to 1.15.0:**
  - **#1059** — Rule pack distribution (headline)
  - Strategy **#35** — Distributing compiled rules (headline)
  - **#1221** — Cloud compile worker Sonnet routing (critical for cloud distribution)
  - **#1232** — Thread explicit `cwd` through `compileCommand` (#1234 follow-up)
  - **#1233** — Stray `packages/core/{}` file created during `pnpm build`
  - **#1235** — Batch `--upgrade` hashes in `runSelfHealing`
  - **#1218** — Broad `throw $ERR` ast-grep pattern needs refinement
  - **#1219** — Lazy-load compiler prompt templates

### After Next: 1.16.0 — The Ingestion Pipeline

Theme: Source Diversity and the Self-Healing Loop. Convert external signals (GHAS alerts, lint warnings) into Totem lessons. Headline work: Strategy #50 + #51 + ADR-086 External Alert Ingestion.

- **Deferred to 1.16.0:**
  - Strategy **#50** — GHAS / SARIF alert extraction (headline)
  - Strategy **#51** — Lint warning extraction (headline)
  - **#1226** — SARIF upload hex escape fix (load-bearing for SARIF ingestion)
  - **#1279** — Pipeline 5 hallucination bug (sand before ingestion ships; escalated from 1.14.0 post-evidence)
  - Strategy **#17** — Governance eval harness (validate ingested inputs)

### Backlog (Horizon 3+)

- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

### Recently Completed

**1.13.0 — The Refinement Engine (2026-04-07)**

Theme: Telemetry-driven rule refinement, compilation routing, and AST upgrades.

- Sonnet 4.6 compile routing (#1220) with ast-grep prompt bias
- Bulk Sonnet recompile: 438 → 393 rules, 102 regex→ast-grep upgrades, 143 noisy rules purged (#1224)
- Context telemetry in rule metrics (#1132 / #1227) — per-context match distribution
- `totem doctor` upgrade diagnostic + `compile --upgrade <hash>` (#1131 / PR #1234) — the refinement loop headline
- AST empty-catch detection (#664) — 8 rules upgraded
- Lesson protection rule (governance) — Pipeline 1 error-severity block on destructive shell removal of the load-bearing lessons file, after a 41-rule near-miss
- Em-dash parseLessonsFile fix (#1278, closes #1263)
- Pipeline 1 Message field + nonCompilable observability tuples (#1282, closes #1265 + #1280)
- Standalone binary distribution unblocked (#1241 arc: #1260 → #1261 → #1266 → #1267) — real binaries on darwin-arm64, linux-x64, win32-x64

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

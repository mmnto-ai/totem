### Active Work Summary

The project is at release `@mmnto/cli@1.13.0` (published 2026-04-07, "The Refinement Engine") with **2,722 tests** across core, CLI, and MCP packages and **394 compiled rules** (up from 393 after the 1.14.0 lesson extraction + Sonnet compile). **1.14.0 is scope-locked and in release prep** — Cross-Repo Context Mesh as the headline feature plus LLM Context Caching machinery shipping as opt-in preview. Theme renamed to "The Nervous System Foundation" to reflect what actually landed (previously locked as "The Distribution Pipeline," which now slides to 1.15.0).

### Current: 1.14.0 — The Nervous System Foundation (release prep)

Theme: Cross-repo federated context (active default) plus opt-in preview of persistent LLM context caching — two halves of the same nervous system, shipping at different maturity levels in 1.14.0 (mesh active, caching opt-in preview pending default activation in 1.15.0 per mmnto/totem#1291).

- **Cross-Repo Context Mesh (shipped, active default):**
  - ~~**#1295**~~ — Phases 1-3 of Proposal 215. `linkedIndexes: []` config, required `SourceContext` on `SearchResult`, federated search with cross-store RRF merge, per-query runtime warnings (not session-persistent), collision-safe failure log, targeted boundary routing (Case 2 isError on full failure, Case 3 for broken-init links), dimension-mismatch diagnostic that persists until the index is fixed, one-shot flags consumed only after successful work, empirical smoke test
  - 9 bot review rounds, ~27 findings resolved across 9 fix commits — see PR body for the full architectural journey

- **LLM Context Caching — Opt-In Preview (shipped, default off):**
  - ~~**#1292**~~ — Phases 1-3 of Proposal 217. Anthropic `cache_control` wired through orchestrator middleware for compile + review paths. Sliding TTL configurable via `cacheTTL` (constrained to Anthropic's two supported values: `300` default or `3600` extended); resets on every cache hit, so bulk recompile runs stay warm end-to-end **when enabled**. Defaults to off in 1.14.0 — opt-in via `enableContextCaching: true` in `totem.config.ts` to avoid surprising existing users mid-cycle with a token-usage profile shift. Default activation tracked for 1.15.0 in mmnto/totem#1291. Anthropic-only in 1.14.0; Gemini `CachedContent` tracked for 1.16.0+. The full machinery (orchestrator middleware, schema field, TTL-literal validation, per-call cache metric tracking) ships in 1.14.0 — only the default-on behavior is deferred.

- **Workflow governance (shipped):**
  - ~~**#1296**~~ — `/preflight` skill v2. Adds triage-gated design-doc phase between `totem spec` and code for architectural changes. Six-subsection template (scope, data model, state lifecycle, failure modes table, invariants, open questions) + explicit approval gate. Direct response to the #1295 review cycle — ~70-80% of the ~27 findings would have been caught by a 1-page design doc before any code was written. Tactical changes skip Phase 3 via explicit triage checklist

- **Governance + cleanup (shipped this branch):**
  - ~~**chore**~~ — Extract 19 lessons from the 1.14.0 PR arc (#1292, #1295, #1296)
  - ~~**chore**~~ — Compile 1 new rule from those lessons via local Sonnet (394 total, up from 393). 18 lessons skipped as architectural/conceptual — they become `nonCompilable` tuples for doctor triage. (Initial pass produced a `process.exit($CODE)` ast-grep rule + a malformed delimiter pattern; the delimiter lesson was reframed as architectural after both bots flagged the broken pattern, so it now ships as documentation only.)

- **Pre-release checklist:**
  - [x] Update `docs/active_work.md`
  - [ ] Update `docs/roadmap.md` (handled by `totem docs` generation; not hand-edited)
  - [ ] Update README + wiki (hand off to Gemini)
  - [x] Add changeset (minor for `@mmnto/cli` + `@mmnto/totem` + `@mmnto/mcp`)
  - [ ] File totem-playground tickets for playground refresh (validate mesh federation from playground)
  - [ ] Rebuild standalone binary for linux-x64, darwin-arm64, win32-x64
  - [x] Push branch + open release prep PR (mmnto/totem#1300)
  - [ ] Merge release PR + Version Packages PR to publish 1.14.0

- **Deferred to 1.15.0 — The Distribution Pipeline** (slid from 1.14.0 when the mesh + caching arc shipped first):
  - **#1059** — Rule pack distribution (headline)
  - Strategy **#35** — Distributing compiled rules (headline)
  - **#1221** — Cloud compile worker Sonnet routing (critical for cloud distribution)
  - **#1232** — Thread explicit `cwd` through `compileCommand` (#1234 follow-up)
  - **#1233** — Stray `packages/core/{}` file created during `pnpm build`
  - **#1235** — Batch `--upgrade` hashes in `runSelfHealing`
  - **#1218** — Broad `throw $ERR` ast-grep pattern needs refinement
  - **#1219** — Lazy-load compiler prompt templates

- **Deferred to 1.16.0 — The Ingestion Pipeline** (slid from 1.15.0):
  - Strategy **#50** — GHAS / SARIF alert extraction (headline)
  - Strategy **#51** — Lint warning extraction (headline)
  - **#1226** — SARIF upload hex escape fix (load-bearing for SARIF ingestion)
  - **#1279** — Pipeline 5 hallucination bug (sand before ingestion ships; escalated from 1.14.0 post-evidence)
  - Strategy **#17** — Governance eval harness (validate ingested inputs)

- **Backlog (Horizon 3+):**
  - Strategy **#6** — Adversarial trap corpus
  - Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
  - Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
  - **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

### Next: 1.15.0 — The Distribution Pipeline

Theme: The Totem Pack Ecosystem. 1.14.0 proved the Nervous System (federated context + cached tokens); 1.15.0 lets teams bundle and share compiled rules across repositories via the npm registry. Headline work: #1059 + Strategy #35 + ADR-085 Totem Pack Ecosystem. Cleanup tickets bundled as operational chores along the way (see "Deferred to 1.15.0" above).

### After Next: 1.16.0 — The Ingestion Pipeline

Theme: Source Diversity and the Self-Healing Loop. Convert external signals (GHAS alerts, lint warnings) into Totem lessons. Headline work: Strategy #50 + #51 + ADR-086 External Alert Ingestion.

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

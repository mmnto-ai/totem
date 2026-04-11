### Active Work Summary

The project is at release `@mmnto/cli@1.14.5` (published 2026-04-11, the tail end of the four-P0 governance sweep) with **2,765 tests** across core, CLI, and MCP packages and **394 compiled rules** (393 active, 1 archived via the #1345 filter).

### Recently Shipped (2026-04-11, the marathon day)

**Two marathon sessions in one day.** Morning shipped 1.14.1 + 1.14.2 and filed four P0 governance bugs. Afternoon closed all four P0s across three patch releases.

- **1.14.5** (#1356, closes #1329) — `safeExec` swapped from `execFileSync` to `cross-spawn.sync` to close the Windows shell-injection vector that had been latent for three weeks. Full rewrite with `SafeExecErrorFields` interface exported, raw stdout/stderr preservation, and cause-chain-friendly wrapping.
- **1.14.4** — Two governance engine fixes bundled:
  - **#1348** (closes #1337) — `totem lesson compile` no-op branch now detects `input_hash` drift and refreshes `compile-manifest.json`. Uses fail-loud semantics for corrupted JSON / permission errors, with `Error.cause` chain walking (bounded depth 8) for ENOENT detection.
  - **#1349** (closes #1339) — `validateAstGrepPattern` now has a parser-based second layer via `@ast-grep/napi`. LLM-produced syntactically-invalid ast-grep patterns can no longer slip through the compile gate into `compiled-rules.json`.
- **1.14.3** — The Archive Lie filter:
  - **#1345** (closes #1336) — One-line filter in `loadCompiledRules`: `parsed.rules.filter((r) => r.status !== 'archived')`. The self-healing loop is no longer a placebo. `totem doctor --pr` archive paths now actually silence rules.
  - **#1347** — First production use of the #1345 filter. Archived over-broad diff-header rule `7e511801` instead of deleting it. The loop healed its own friction source within hours of the filter landing.
- **#1353** — README docs restoration: added back SARIF + CI/CD and air-gapped coverage that got dropped during the voice-refresh cycle (#1320 → #1341 → #1343). Voice-audited against `.strategy/voice-tuning-dataset.md`.

### Follow-up tickets filed during the sweep

All filed from bot review findings during the marathon; all deferred with tracked follow-ups rather than inline fixes:

- **#1350** — Symmetric missing-`lessonsDir` handling across both compile branches (surfaced by GCA review of #1348, out of scope for a hotfix).
- **#1352** — Archive 3 over-broad Pipeline 5 `split()` rules that blocked #1349's legitimate code.
- **#1354** — DRY extraction of `ok()`/`fail()` spawn mock helpers to a shared test-utils module (CR review finding on #1356).
- **#1355** — Tighten `Standardize exception messages` lint rule so it does not fire on internal-wrapper `Error` constructions (surfaced during #1349 and #1356).
- **#1357** — Migrate `safeExec` callers to walk cause chain per general rule 102 (GCA concurred this deferral is legitimate).

### Current: 1.15.0 — The Distribution Pipeline

All four pre-1.15.0 blocker P0s are now closed. Phase 2 (mesh completion) can proceed without tripping over the same governance-engine rakes that surfaced during the 1.14.2 rename PR.

**Phase 2 — Mesh completion (wraps up the 1.14.0 "Nervous System Foundation" story arc):**

- **#1307** — CLI `totem search` silently ignores `linkedIndexes`.
- **#1308** — `totem doctor` has no Linked Indexes health check.

**Phase 3 — Pack MVP (headline 1.15.0 work):**

- **#1059** — Rule pack distribution (headline)
- Strategy **#35** — Distributing compiled rules (headline)
- **#1243** — Pack schema (reads Gemini's Proposal 223 in `.strategy/proposals/active/223-pack-distribution.md`)

**Bundled cleanup:**

- **#1221** — Cloud compile worker Sonnet routing (critical for cloud distribution)
- **#1232** — Thread explicit `cwd` through `compileCommand` (#1234 follow-up)
- **#1235** — Batch `--upgrade` hashes in `runSelfHealing`
- **#1218** — Broad `throw $ERR` ast-grep pattern needs refinement
- **#1219** — Lazy-load compiler prompt templates
- **#1350**, **#1352**, **#1354**, **#1355**, **#1357** — Follow-ups from the 2026-04-11 four-P0 sweep

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
  - Strategy **#17** — Governance eval harness (validate ingested inputs)

_#1279 (Pipeline 5 hallucination bug) shipped in 1.14.1 as the pre-ingestion sanity gate — item removed._

### Backlog (Horizon 3+)

- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

### Recently Completed

**1.14.x cycle — Nervous System Foundation + Hotfix Sweep + Four-P0 Governance Sweep (2026-04-09 → 2026-04-11)**

- **1.14.0** (2026-04-09) — The Nervous System Foundation. Headline: Cross-Repo Context Mesh (#1295), LLM Context Caching preview (#1292), `/preflight` v2 (#1296).
- **1.14.1** (2026-04-11 morning) — Hotfix Sweep + Phase 1 Papercuts. Bundled #1279, #1281, #1233, #1284, #1311 (with its 4 sub-fixes), #1317, #1318, #1319, #1310. **Nine PRs merged.**
- **1.14.2** (2026-04-11 morning) — Cosmetic `DISPLAY_TAG = 'Review'` split to print `[Review]` instead of `[Shield]` in `totem review` output. `TAG = 'Shield'` internal routing key kept verbatim (config lookup key, rename is tech debt in #1335).
- **1.14.3 / 1.14.4 / 1.14.5** (2026-04-11 afternoon) — Four-P0 governance sweep: #1336 + #1337 + #1339 + #1329 all closed. Full session narrative in `.strategy/.journal/2026-04-11-four-p0-sweep-and-1.14.5-shipped.md`.

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

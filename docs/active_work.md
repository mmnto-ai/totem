### Active Work Summary

The project is at release `@mmnto/cli@1.14.8` (published 2026-04-14) with **1.14.9 — Precision Engine** feature-complete on `main` and pending release. Test counts: **2,879 across core, CLI, and MCP packages**. **411 compiled rules** in the rules array (389 active, 22 archived). The `nonCompilable` ledger separately tracks 889 lessons the LLM declined to convert into rules; that array is sibling to `rules` and not counted toward `rule_count`. The next release ships compound ast-grep rule support, a compile-time smoke gate, and the `badExample` requirement that closes the LLM-hallucination loop.

### Recently Shipped

**1.14.9** (feature-complete on `main`, release pending) -- The Precision Engine. Compound ast-grep rule support + compile-time smoke gate. Closes the loop on rule quality before Pack Distribution starts.

- **#1410** (closes #1406) -- spike: `@ast-grep/napi` compound YAML rule validation. ADR promotion gate for Proposal 226. Empirically proved the runtime accepts NapiConfig polymorphically; identified the `inside: { pattern: ... }` silent-zero-match sharp edge that drove the `kind:` allow-list in #1409.
- **#1412** (closes #1407) -- feat(core): `astGrepYamlRule` field on `CompiledRule` schema with mutual exclusion via `superRefine`. Optional `badExample` field added (flipped to required in #1420). Deterministic manifest hashing via `canonicalStringify` so key-order variation in compound rules cannot trip `verify-manifest`. Backward-compat guard preserves existing manifests byte-for-byte.
- **#1415** (closes #1408) -- feat(core): runtime engine support for compound rules. Per-rule try/catch in `executeQuery` so one malformed rule cannot crash a whole file's lint pass. New `'failure'` event variant on `RuleEventCallback` (semantically distinct from `'suppress'`). New `compile-smoke-gate.ts` module that runs every Pipeline 2/3 rule against its own `badExample` snippet at compile time.
- **#1420** (closes #1409) -- feat(cli): compiler prompt rewrite teaching Sonnet to emit compound rules with `kind:` for outer combinator targets. Flipped `CompilerOutputSchema.badExample` from optional to required for ast-grep AND regex engines. New `KIND_ALLOW_LIST` exported constant — single source of truth for permitted outer-combinator kinds, will feed `totem doctor` linting in a future release. Postmerge (#1422) extracted 4 architectural lessons; LLM correctly classified all 4 as nonCompilable.

**Architectural impact:** Pipeline 2 compile throughput dropped to near zero between #1415 and #1420 because the gate started rejecting rules before Sonnet was taught to emit `badExample`. This was the gate working as designed — better zero rules than zero-match hallucinations distributed via packs. Pipeline 1 (manual) gate enforcement is deferred to #1414 pending a 136-lesson backfill sweep.

**1.14.8** (2026-04-14) -- Perf Follow-up. Final patch closing the 1.14.x cycle.

- **#1401** -- Thread explicit `cwd` through `compileCommand` (#1232); batch upgrade hashes in `runSelfHealing` (#1235) to avoid N load cycles; fail-loud guard on unresolved batch hashes.
- **#1402** -- Pull request template enforcing Mechanical Root Cause + Out of Scope structure.
- Postmerge: 7 new lessons, 1 rule compiled (archived for over-breadth).

**1.14.7** (2026-04-13) -- Nervous System Capstone. Closes the 1.14.x arc.

- **#1395** -- Tactical cleanup: bot reply protocol docs (#1391), NO_LESSONS_DIR guard (#1350), test-utils DRY (#1354), cause chain migration (#1357)
- **#1396** -- Mesh completion: `totem search` federation across linkedIndexes (#1307), `totem doctor` Linked Indexes health check (#1308)

**1.14.6** (2026-04-13) -- Quality Sweep Phase 1-2 and Voice Compliance.

- Voice-scrub follow-ups (#1379, #1382, #1383)
- Quality sweep: 7 over-broad rules archived, 1 duplicate lesson retired (#1387), export glob fix (#1388), throw-err archive (#1389)
- Postmerge: 31 lessons from 1.14.3-1.14.5 marathon (#1384, #1385)

### Previously Shipped (2026-04-11, the marathon day)

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

**Blocked by the pre-1.15.0 deep review gate (#1421).** All 1.15.0 implementation tickets are paused until the foundation review passes. Rationale: Pack Distribution is the first release where rules leave the repo, so foundation bugs would distribute to every downstream consumer. Catching at the foundation layer is orders of magnitude cheaper than retro-fixing every pack consumer.

Once #1421 closes, 1.15.0 implementation work begins. Phase 2 (mesh completion) can proceed without tripping over the same governance-engine rakes that surfaced during the 1.14.2 rename PR.

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

**1.14.9 follow-ups (unmilestoned, unblock between cycles):**

- **#1414** — Pipeline 1 smoke gate flip after 136-lesson Bad Example backfill. Mechanism shipped in #1415; hard enforcement deferred until the curation sweep.
- **#1418** — MCP server holds a stale LanceDB handle after `totem sync` rebuilds embeddings. Surfaced empirically while syncing the strategy submodule reorg. 1.14.x patch or 1.15.0 pre-distribution hardening; Pack Distribution cannot ship a stale-handle bug in the federated query surface.
- **#1419** — Cryptographic attestation for the Trap Ledger (SOX compliance gap). Filed at tier-3 by Gemini. Closes the gap in Proposal 225's enterprise pitch where the ledger was claimed as "cryptographically logged" but is currently a flat append-only file.
- **#1421** — Pre-1.15.0 deep code review gate. Four-surface independent pass on `main` between 1.14.9 release and the first 1.15.0 ticket.

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

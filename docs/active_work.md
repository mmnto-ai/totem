### Active Work Summary

The project is at release `@mmnto/cli@1.14.10` (published 2026-04-15). Test counts: **2,922 across core, CLI, and MCP packages**. **414 compiled rules** in the rules array (392 active, 22 archived). The `nonCompilable` ledger separately tracks 889 lessons the LLM declined to convert into rules; that array is sibling to `rules` and not counted toward `rule_count`. 1.15.0 Pack Distribution is blocked by the pre-1.15.0 deep review gate (#1421); the 2026-04-15 joint planning pass (Ultraplan + strategy-repo pair) locked a three-phase sequence of workflow setup, gated grind, and pack delivery before the first 1.15.0 implementation ticket moves.

### Recently Shipped

**1.14.10** (2026-04-15) -- The Bundle Release. Three PRs:

- **#1429** -- shell-orchestrator `{model}` token RCE fix. Three rounds of GCA + Shield review: `MODEL_NAME_RE` unification, Windows MSVCRT escape, `TotemConfigError`, replacer-function interpolation to dodge `$&` back-reference regressions.
- **#1454** -- Pipeline 1 compound rule authoring. Four rounds of CR + GCA review. Shared `assertValidModelName` helper, `TotemParseError` for regex failures, narrow-false pattern on `isFileDirty` and `resolveGitRoot`, markdown-heading terminator on YAML scan, `totem-context:` migration on `sys/git.ts`. Three inaugural compound rules shipped (rule count 411 → 414).
- **#1455** -- Version Packages auto-PR. Three CHANGELOG.md nits fixed inline: `MODEL_SAFE_RE` → `MODEL_NAME_RE`, `TotemError(CHECK_FAILED)` → `TotemParseError`, broken fence formatting rewritten.

Follow-ups filed from this sweep: #1456 (Repomix audit commit + submodule bump), #1457 (totem-ignore → totem-context: migration), #1458 (replace back-reference idiom in lesson-pattern.ts), #1459 (fill 61 scaffolded-but-TODO fixture files).

**1.14.9** (2026-04-15) -- The Precision Engine. Compound ast-grep rule support + compile-time smoke gate. Closes the loop on rule quality before Pack Distribution starts.

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

**Blocked by the pre-1.15.0 deep review gate (#1421).** 24 tickets carry the `pre-1.15-review` label (12 tier-1 bugs, 9 tier-2 cleanup, 3 untiered), plus follow-ups #1456-#1459 from the 2026-04-15 PR sweep. All 1.15.0 implementation tickets are paused until the foundation review passes. Pack Distribution is the first release where rules leave the repo, so foundation bugs would distribute to every downstream consumer. Catching at the foundation layer is orders of magnitude cheaper than retro-fixing every pack consumer.

The 2026-04-15 joint planning pass (Ultraplan cloud session + strategy-repo pair audit) locked a three-phase sequence of workflow improvements, gated grind, and pack delivery. Phases run in order; each phase has an explicit checkpoint before the next starts.

**Phase A: Workflow setup before the grind.** Cut bot-review-cycle cost before running it 24 times.

- **Preflight v2 skill:** already shipped via #1296 (1.14.0) and #1299 (1.14.1). Proposal archived to `proposals/archive/` on 2026-04-15 after both planning passes tripped on the unarchived file.
- **Tier-2 docs promotion:** Monitor tool and `/loop` self-paced examples into CLAUDE.md. Proposal 232 Tier 2 items promoted based on recurrence during the grind.
- **#1460:** PreCompact hook. Highest blast radius of the workflow items; test in throwaway session with manual `/compact` before enabling globally.
- **#1462:** if-scope `review-gate.sh`. One-line settings change narrowing from every Bash call to `Bash(git push*)`. Verify on a throwaway PR.
- **#1461:** `/autofix-pr` trial. Run on the first Phase B bundle PR (concurrent, not prerequisite) for real bot-review pressure on the round-count comparison.

**Phase A.5: Architectural gates before the grind.** Strategy-pair audit surfaced two proposals that gate 1.15.0 foundations:

- **Proposal 202:** Stacked Compilation Architecture. Promote to ADR and ticket as `pre-1.15-review`. Without a layered AST → template → LLM+verify → explicit-fail fallback, packs ship the 0/6 usable-rule failure mode from the 1.6.0 stress test. Load-bearing.
- **Proposal 228:** Zero-Trust Agent Governance. Promote to ADR and commit `@totem/pack-agent-security` to 1.15.0 as the flagship pack (first production consumer of the pack infrastructure).

**Phase B: Pre-1.15-review grind.** 24 tickets ordered for minimum cross-PR interference:

1. **#1279 first.** Pipeline 5 over-narrow captures. De-noising step for the whole grind; workaround fired four times on the 1.14.10 branch alone.
2. **Tactical cleanup batch:** #1456, #1457, #1458, #1459 as four small PRs. First real exercise of the Preflight v2 tactical triage posture.
3. **Tier-1 bundles grouped by `scope:` label:** mcp, cli, compiler, orchestrator, store. One bundle per PR; within each bundle, deepest architectural layer first so cascade fixes land before surface fixes.
4. **Tier-2 cleanup** after tier-1 closes.
5. **Re-tier the 3 untiered** during the Phase A planning window. Any that resolve to tier-3 or post-1.0 lose the `pre-1.15-review` label per ADR-075.

**Phase C: Pack Distribution headline work.** Gated on ADR-085 promotion from Proposed to Accepted.

- **#1421 meta-gate closes.**
- **Promote ADR-085 (Totem Pack Ecosystem) to Accepted** with the five deferred decisions resolved: SemVer mapping, local-overrides-pack merge rule, conflict resolution, pack lifecycle, signing.
- **Decompose ADR-085 into tickets:** pack resolver in `totem.config.ts` `extends` array, pack fetcher, signature verification, hash-stable compilation (#1232 is a prerequisite), pack lifecycle commands (`totem pack publish`, `totem pack verify`).
- **Build `@totem/pack-agent-security`** as the flagship pack (Proposal 228).
- **Wire Proposal 229 TBench spot-check** as the pack-release gate. Full harness stays Horizon 3; the spot-check is the 1.15.0-scoped subset.
- **Decide ADR-086 (External Alert Ingestion) fate:** defer to 1.15.1 or 1.16.0. Recommend defer; Ingestion is wide and should not ride with Distribution.

**Proposal dispositions from the 2026-04-15 audit.**

- **Archive (already shipped):** `preflight-v2.md` (done 2026-04-15).
- **Promote to ADR this cycle:** 202 (Stacked Compilation, `pre-1.15-review`), 228 (Zero-Trust, 1.15.0 flagship pack).
- **Lock at 1.16.0:** Proposal 217 (LLM context caching).
- **Lock at 1.17.0 with open-question iteration first:** Proposal 230 (content-hash embedding cache; three open questions on `library_version` keying, eviction policy, hit-ratio telemetry).
- **Decompose as tickets now:** Proposal 191 vectors A+B (JIT bot prompts, trap-ledger pruning). Vector C (semantic LSP) stays Horizon 3+.
- **Split into two tickets:** Proposal 229 (TBench spot-check 1.15.0, full harness Horizon 3).
- **Formalize decision gate before further work:** Proposal 227 (multi-axis platform strategy; architectural roadmap vs decision-framing doc is unresolved).
- **Stay parked:** 218 (governance fine-tuning, Horizon 3), 231 (P2P Iroh, Horizon 3+).
- **Active reference through the cycle:** 232 (archive after Tier-1 items close).

**Undecomposed ADR backfill candidates.** Strategy-pair audit identified 22 Accepted ADRs with zero ticket citations; 16 are buildable. Five highest-leverage for near-term pickup (all touch pack + ingestion paths):

- **ADR-004:** AST-Aware Git Diff Analysis (Tree-sitter line-mapping + scope field on compiled rules).
- **ADR-015:** Zero-Config Architectural Detection (5-stage fingerprinting).
- **ADR-017:** Vector Cache Invalidation & Data Drift (hash-based staleness for LanceDB).
- **ADR-025:** `totem doctor` Diagnostic Architecture.
- **ADR-039:** Deterministic Briefing & Handoff.

Backfill these as the 24-ticket grind drains.

**Milestone guidance.** Per ADR-075, the 1.15.0 GitHub milestone stays thematically locked to Pack Distribution. The 24 `pre-1.15-review` tickets track via the label filter rather than attaching to the milestone. A dedicated "Pre-1.15.0 Gate" milestone is optional; the label filter suffices.

**Watch-outs.**

- **Phase A:** PreCompact hook (#1460) exit-2 blocks compaction indefinitely; recoverable only by hand-editing settings.json. Test in throwaway session first.
- **Phase B:** Scope interleaving in PRs multiplies bot-review findings. One bundle per PR; do not mix `scope: mcp` and `scope: cli` in the same diff.
- **Phase C:** Do not change compile-pipeline substrate (Proposals 217, 230) in the same release as the pack-distribution feature on top of it. Both are quarantined to 1.16.0+.

**Other pending work (unmilestoned, unblock between cycles):**

- **#1414:** Pipeline 1 smoke gate flip after 136-lesson Bad Example backfill. Mechanism shipped in #1415; hard enforcement deferred until the curation sweep.
- **#1419:** Cryptographic attestation for the Trap Ledger (SOX compliance gap). Filed at tier-3 by Gemini. Closes the gap in Proposal 225's enterprise pitch where the ledger was claimed as "cryptographically logged" but is currently a flat append-only file.
- **#1421:** Pre-1.15.0 deep code review gate (the meta-gate for the Phase B grind).

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

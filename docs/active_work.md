### Active Work Summary

The project is at release `@mmnto/cli@1.14.13` (published 2026-04-19). Test counts: **3,164 across eight packages** (core, CLI, MCP, pack-agent-security). **439 compiled rules** in the rules array (378 active, 61 archived) in the root manifest, plus 5 immutable rules in `packages/pack-agent-security/compiled-rules.json`. The `nonCompilable` ledger separately tracks lessons the LLM declined to convert into rules; that array is sibling to `rules` and not counted toward `rule_count`. 1.15.0 Pack Distribution is blocked by the pre-1.15.0 deep review gate (#1421); the 2026-04-15 joint planning pass locked a three-phase sequence of workflow setup, gated grind, and pack delivery. **Phase A and Phase A.5 landed on 2026-04-16.** ADR-085 (Pack Ecosystem), ADR-087 (Compound ast-grep Rules, promoted 2026-04-18), ADR-088 (Stacked Compilation), ADR-089 (Zero-Trust Agent Governance), ADR-090 (Multi-Agent State Substrate), and ADR-091 (Ingestion Pipeline Refinements, promoted 2026-04-19) all Accepted. Phase B (pre-1.15-review grind) is active. **Full corpus audit completed 2026-04-19** — see `.strategy/docs/active_work.md` and `.strategy/docs/roadmap.md` for the authoritative strategy-side state post-audit.

### Recently Shipped

**2026-04-19** (no npm release; docs + governance) -- Full corpus audit across both repos; Phase 5+6 roadmap synthesis.

- **Strategy PR #97** (`07a3bc0`) -- 2026-04-19 full corpus audit Phase 1-4. 18 ADRs vocab unified on `Accepted` (RAG authority filter now picks up the full set). ADR-053 and ADR-054 Status lines restored. 8 duplicate proposal numbers resolved via renumber to 235-242; 3 citation updates landed with the rename. 8 obsolete proposals archived per user per-item approval. 3 proposal Status-location frontmatter mismatches fixed.
- **Strategy PR #99** (`f59136f`) -- Phase 5+6 roadmap synthesis + handoff journal + audit report TL;DR. New `.strategy/docs/active_work.md` and `.strategy/docs/roadmap.md` are the authoritative strategy-side state going forward.
- **Live-issue actions (outside PRs):** 8 retier labels applied across both repos. 3 tier-1 demotions based on 30+ day orphan status (`strategy#11` Federated Memory, `totem#624` DeepSeek orchestrator, `totem#701` Baseline Truth Check). 3 milestone-attached untiered tickets tiered (`totem#1381` tier-2, `totem#1226` tier-1, `totem#1221` tier-2). 2 cross-ref comments wiring `totem#1253` ↔ `strategy#51` (ADR-086 extract-lint pair). Tickets closed: `strategy#22` (deduplicate proposals directory, auto-closed on PR #97 merge), `strategy#54` (WSL2 migration research, user-approved). Tickets filed: `strategy#96` (Proposal-authoring tracker for totem#1037 agent-escalation), `strategy#98` (analyzer-script hardening follow-ups).
- **Methodology invariants held.** Zero blanket closures. Zero archive decisions without explicit user approval. Full bot-review and pushback narrative lives in the session journal at `.strategy/.journal/2026-04-19-full-audit-executed.md`.

**2026-04-16 session (no npm release; dev-infra and scope)** -- Phase A workflow setup closed, Phase A.5 architectural gates closed, Phase B started.

- **Strategy repo PRs.** `mmnto-ai/totem-strategy#86` promoted ADR-085 to Accepted with the five deferred decisions resolved (Behavioral SemVer with refinement classification, array-order precedence plus `totem doctor` shadowing warning, Local Supreme Authority with ADR-089 immutable-severity carve-out, Sigstore + in-toto, native npm lifecycle with 72-hour unpublish constraint). `mmnto-ai/totem-strategy#87` landed ADR-090 (Totem as the Multi-Agent State Substrate) with Scope Decision Test, Deferred Decisions, and Risk Assessment. Both drafted by Gemini, audited by Claude, merged by strategy-pair Claude.
- **Parent repo infrastructure PRs.** `#1477` documented Claude Opus 4.7 flagship in `supported-models.md` with the sampling-params / adaptive-thinking / tokenizer migration notes. `#1496` bumped the `.strategy` submodule pointer to pick up all three new Accepted ADRs. `#1501` consolidated 5 inline `safeField.replace` sites to the shared `escapeRegex` helper and extended the helper to escape hyphen per MDN canonical set.
- **Tickets decomposed.** 16 tickets filed from ADR-088 Phase 1 (#1479-#1483) and ADR-089 (#1484-#1494). ADR-085 resolved-decision follow-ups ticketed as #1494 (shadowing warning) and #1495 (Rule Identity Model placeholder, deferred architectural decision from #86 review). ADR-090 decomposed into #1497 (rich `describe_project` MCP), #1498 (init auto-detect agent runtimes, supersedes closed #124 and #129), #1499 (preflight scope-triage gate), #1500 (positioning copy sweep). Separate follow-ups: #1476 (Opus 4.7 sampling-param strip), #1478 (multi-agent federated signoff collision), #1502 (narrow replacement for archived rule `939ae83ed3bf28bb`), #1504 (post-ADR-088 audit of pre-1.13.0 rule corpus, hard-blocked on #1479-#1483).
- **Audit-driven backlog tuning.** Gemini ran a cross-repo ticket audit. 4 tier-1 demotions to tier-2 (#1486, #1487, #1488, #1492) to relieve the tier-1 overload (28 → 24). `#1497` and `#1498` attached to 1.16.0 milestone so the Human DX / Agent AX track does not pollute 1.15.0's Pack Distribution theme. Results in `.strategy/audits/internal/backlog-audit-2026-04-16.md`.
- **Phase B first PR shipped.** `#1503` merged 2026-04-16 scaffolding `@totem/pack-agent-security` (the ADR-089 flagship pack). Empty rules array shape matches `CompiledRulesFileSchema`, `.totemignore` template, README with honest coverage boundaries, 6 unit tests pinning structural invariants. `.` root export added to `package.json` during review for strict ESM resolution. Also archives rule `939ae83ed3bf28bb` inline (over-broad fileGlob on all `compiled-rules.json` files blocked the pack from shipping its own seed manifest) and rule `e2341ed9229f9a60` inline (incidental compile with pattern `new $ERROR($$$ARGS)` that matches every class instantiation, not just error wrapping). Both archives carry explicit reasons citing the bot reviews that caught them.
- **ADR-090 tenet in force.** Totem is the Shared State, Shared Enforcement, and Shared Audit Substrate for multi-agent development. Totem does not own agent routing, capability negotiation, session lifecycle management, or live-edit conflict resolution. Future feature decisions pass the Scope Decision Test in ADR-090 before admission. This retires the informal "everything is a Totem feature" temptation that was flagged during the 2026-04-16 scope conversation.

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

**Phase A and Phase A.5 landed on 2026-04-16.** Phase B grind underway. The pre-1.15.0 deep review gate (#1421) stays open until Phase B drains. ~29 tickets carry the `pre-1.15-review` label after today's decomposition (5 ADR-088 Phase 1 tickets added, tier-1 overload relieved via 4 demotions, see 2026-04-16 session notes above).

The 2026-04-15 joint planning pass (Ultraplan cloud session + strategy-repo pair audit) locked a three-phase sequence of workflow improvements, gated grind, and pack delivery. Phases run in order; each phase has an explicit checkpoint before the next starts.

**Phase A: Workflow setup before the grind. [DONE]** Cut bot-review-cycle cost before running it across the grind.

- **Preflight v2 skill** shipped via #1296 (1.14.0) and #1299 (1.14.1). Proposal archived 2026-04-15.
- **Tier-2 docs promoted** to CLAUDE.md via #1466 (Monitor tool over sleep loops, `/loop` self-paced for poll-and-react).
- **PreCompact hook** shipped via #1470. Three-run happy-path drill verified the exit-code contract.
- **review-gate if-scope** narrowed via #1468 to `Bash(git push*)` so the hook no longer slows every Bash call.
- **Turbo cache hash-scope fix** shipped via #1472, correcting the silent-cache-hit gap discovered during #1466 round-trip.
- **/autofix-pr trial** remains outstanding; run when the first Phase B bundle PR accumulates bot pressure.

**Phase A.5: Architectural gates before the grind. [DONE]** Strategy-pair promoted two gating proposals to Accepted, and a third positioning ADR landed during the scope conversation:

- **ADR-088 (Stacked Compilation Architecture, was Proposal 202).** Accepted on `mmnto-ai/totem-strategy#85` (2026-04-15). Phase 1 tickets decomposed on 2026-04-16 as #1479 (verify-retry loop), #1480 (unverified flag), #1481 (reason codes), #1482 (verbose trace), #1483 (doctor zero-match), all `pre-1.15-review`. Phase 2 (Layers 1 and 2) stays 1.16.0+.
- **ADR-089 (Zero-Trust Agent Governance, was Proposal 228).** Accepted on `mmnto-ai/totem-strategy#85`. Flagship pack `@totem/pack-agent-security` commits to 1.15.0. Decomposed on 2026-04-16 into #1484-#1494 across scaffolding, security rules, install path, signing, lifecycle. Scaffolding PR #1503 merged on 2026-04-16.
- **ADR-085 (Totem Pack Ecosystem).** Accepted on `mmnto-ai/totem-strategy#86` with the five deferred decisions resolved (see 2026-04-16 session notes above). Resolved-decision follow-ups ticketed as #1494 (doctor shadowing warning) and #1495 (Rule Identity Model placeholder ADR).
- **ADR-090 (Totem as the Multi-Agent State Substrate).** Accepted on `mmnto-ai/totem-strategy#87`. Not a gating proposal but landed during the same session to bound future "is this a Totem feature?" decisions. Decomposed into #1497 (rich `describe_project`), #1498 (init auto-detect), #1499 (preflight scope-triage gate), #1500 (positioning copy sweep). #1497 and #1498 attached to 1.16.0 so ADR-090's Human DX and Agent AX tracks do not pollute 1.15.0's Pack Distribution theme.

**Phase B: Pre-1.15-review grind. [IN PROGRESS]** Gemini's 2026-04-16 backlog audit reordered the first five PRs by dependency bottleneck and compounding payoff:

1. **#1484** scaffold `@totem/pack-agent-security`. Blocks 5 security-rule and immutable-flag tickets. Merged as #1503 on 2026-04-16.
2. **#1479** Layer 3 verify-retry loop. Biggest compounding value of the queue; would have caught both over-broad rules archived during #1503. Unblocks #1480 and #1481.
3. **#1485** `immutable` flag on `CompiledRule`. Prerequisite for security rules to enforce the Zero-Trust story with local overrides blocked and bypasses logged to the Trap Ledger.
4. **#1491** `totem install pack/<name>` command. Foundational CLI required before lifecycle (#1493) and Sigstore (#1492) can build on top. Unblocks three downstream tickets.
5. **#1489** obfuscated-string-concat research spike. Time-boxed to 2 days. Produces the validated pattern that #1490 ships.

After the top-5: tactical cleanup batch (#1456, #1457, #1458 closed in #1501, #1459), Phase 1 ADR-088 completion (#1480-#1483), ADR-089 security rules (#1486-#1490), and the install / signing / lifecycle trio (#1491, #1492, #1493). Re-tier untiered tickets per ADR-075 as they surface.

**Phase C: Pack Distribution headline work.** Unblocked now that ADR-085 is Accepted.

- **#1421 meta-gate closes** when Phase B drains.
- **Build `@totem/pack-agent-security`** as the flagship pack (ADR-089 implementation via #1484 scaffold + rule tickets).
- **Wire Proposal 229 TBench spot-check** as the pack-release gate. Full harness stays Horizon 3; the spot-check is the 1.15.0-scoped subset.
- **Decide ADR-086 (External Alert Ingestion) fate.** Recommend defer to 1.16.0; Ingestion is wide and should not ride with Distribution.

**Proposal dispositions (updated 2026-04-16).**

- **Promoted to Accepted ADR:** 202 → ADR-088 (Stacked Compilation), 228 → ADR-089 (Zero-Trust Agent Governance), both on `mmnto-ai/totem-strategy#85`. Plus ADR-090 (Multi-Agent State Substrate, new this session) on `#87`.
- **Archived:** `preflight-v2.md` (done 2026-04-15).
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

Backfill these as the 29-ticket grind drains.

**Milestone guidance.** Per ADR-075, the 1.15.0 GitHub milestone stays thematically locked to Pack Distribution. The `pre-1.15-review` tickets track via the label filter rather than attaching to the milestone. A dedicated "Pre-1.15.0 Gate" milestone is optional; the label filter suffices. ADR-089 implementation tickets (#1484-#1494) ARE attached to the 1.15.0 milestone because they are thematic Pack Distribution work. ADR-090 tickets (#1497, #1498) attach to 1.16.0 by audit recommendation.

**Watch-outs.**

- **Phase B:** Scope interleaving in PRs multiplies bot-review findings. One bundle per PR; do not mix `scope: mcp` and `scope: cli` in the same diff.
- **Phase B dependency order:** Do not start #1486-#1490 security rules before #1485 (immutable flag) lands; severity cannot enforce. Do not start #1504 (pre-1.13.0 sweep) before #1479-#1483 land; there is no gate to check against.
- **Phase C:** Do not change compile-pipeline substrate (Proposals 217, 230) in the same release as the pack-distribution feature on top of it. Both are quarantined to 1.16.0+.
- **Incidental compiles during manifest refresh.** `totem compile` refreshes `compile-manifest.json` but also compiles any ready lessons, which can ship an over-broad rule (`939ae83ed3bf28bb`, `e2341ed9229f9a60` both landed this way during 2026-04-16). Archive inline if it happens; ADR-088 Phase 1 #1479 verify-retry will prevent the class once shipped.

**Other pending work (unmilestoned, unblock between cycles):**

- **#1414:** Pipeline 1 smoke gate flip after 136-lesson Bad Example backfill. Mechanism shipped in #1415; hard enforcement deferred until the curation sweep.
- **#1419:** Cryptographic attestation for the Trap Ledger (SOX compliance gap). Filed at tier-3 by Gemini. Closes the gap in Proposal 225's enterprise pitch where the ledger was claimed as "cryptographically logged" but is currently a flat append-only file.
- **#1421:** Pre-1.15.0 deep code review gate (the meta-gate for the Phase B grind).

### After Next: 1.16.0 — The Ingestion Pipeline

Theme: Source Diversity, the Self-Healing Loop, and substrate-layer DX polish aligned with ADR-090. Convert external signals (GHAS alerts, lint warnings) into Totem lessons. Pair with the Human DX and Agent AX tracks from ADR-090 so the substrate is friction-free for both human setup and incoming agent sessions.

- **Headline (Ingestion):**
  - Strategy **#50** — GHAS / SARIF alert extraction
  - Strategy **#51** — Lint warning extraction
  - **#1226** — SARIF upload hex escape fix (load-bearing for SARIF ingestion)
  - Strategy **#17** — Governance eval harness (validate ingested inputs)

- **ADR-090 substrate DX work attached to 1.16.0:**
  - **#1497** — rich `describe_project` MCP endpoint. Drops session-start briefing from ~5 tool calls to 1. Agent AX track.
  - **#1498** — `totem init` auto-detects Cursor / Windsurf / Claude Code and injects MCP config. Human DX track. Supersedes closed #124 and #129.

- **Infrastructure carried over from 1.15.0 quarantines:**
  - Proposal 217 (LLM context caching). Compile-pipeline substrate; quarantined out of 1.15.0 to avoid distribution-feature-on-substrate-change silent regressions.

_#1279 (Pipeline 5 hallucination bug) shipped in 1.14.1 as the pre-ingestion sanity gate — item removed._

### Backlog (Horizon 3+)

- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)
- **#1504** — Post-ADR-088 audit of pre-1.13.0 rule corpus. Hard-blocked on #1479-#1483 landing. One-shot sweep of ~230 rules compiled before the Refinement Engine; expected 30-50% archive rate based on the 1.13.0 recompile precedent. Filed 2026-04-16 after back-to-back archives of over-broad pre-1.13.0 rules (`939ae83ed3bf28bb` in #1503, `e2341ed9229f9a60` from incidental compile).

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

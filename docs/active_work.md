### Active Work Summary

**1.15.8 published 2026-04-26.** Two-day ship arc closed the upstream-feedback batch from `mmnto-ai/totem-strategy#133` (items 020-024). Four totem feature PRs merged across 2026-04-25/26: applies-to lesson frontmatter substrate (#1667 → 1.15.5), source-Scope override (#1674 → 1.15.6), self-suppressing-pattern reasonCode (#1688 → 1.15.7), triage-pr strict-by-id dedup (#1690 → 1.15.8). Plus postmerge curation PR #1687 and four Version Packages auto-PRs. Strategy-side, took over Proposal 248 PR #136 (Bot Operations Packs) and merged with my amendments; `.strategy/docs/bot-interaction-nuance.md` shipped as the Proposal 248 v0.1 seed corpus. Liquid-city consuming downstream at totem 1.15.6 (LC PR #89 bump). **444 compiled rules** in the root manifest's `rules` array (379 active, 65 archived; rules with unset `status` are treated as active per the `CompiledRuleSchema` default), plus 5 immutable rules shipped in `packages/pack-agent-security/compiled-rules.json`. The `nonCompilable` ledger is sibling to `rules` and not counted toward `rule_count`. **1,167 lessons on disk.** ADR-085 (Pack Ecosystem), ADR-087 (Compound ast-grep Rules), ADR-088 (Stacked Compilation), ADR-089 (Zero-Trust Agent Governance), ADR-090 (Multi-Agent State Substrate), ADR-091 (Ingestion Pipeline Refinements), and ADR-092 (Memory Substrate as Opt-In Agent Feature) all Accepted; ADR-093 (Engine vs Bot Review Positioning) Draft on strategy disk pending PR #132 finalization. Strategy Claude decomposed ADR-091 Stage 4 Codebase Verifier into totem#1682-#1686 during the same session. **Full corpus audit completed 2026-04-19** — see `.strategy/docs/active_work.md` and `.strategy/docs/roadmap.md` for the authoritative strategy-side state. Focus: **1.16.0 Ingestion Pipeline + ADR-091 Stage 4 Codebase Verifier**; see "Current: 1.16.0" section below.

### Recently Shipped

**2026-04-25 / 2026-04-26** (1.15.5 → 1.15.8 four-release arc) -- Upstream-feedback batch from `mmnto-ai/totem-strategy#133` closed five-for-five (items 020 / 021 / 022 / 023 / 024). Four feature PRs + one postmerge PR + four Version Packages auto-PRs + one strategy PR taken-over and merged.

- **PR #1667** (`aebf82fd`) → **1.15.5 published** -- closes #1663 (item 020). `applies-to` lesson frontmatter substrate. New `LessonFrontmatterSchema.appliesTo` with three sub-fields (`fileGlobs`, `pathContains`, `excludeGlobs`); compiler honors as authoritative scope override; conflicts surface as warnings. 41 new tests covering precedence + override paths.
- **PR #1674** (`20c491c1`) → **1.15.6 published** -- closes #1665 (item 023). source-Scope override. Lesson frontmatter `scope: 'tests' | 'src' | 'all'` flips compiler default scope inversion. 27 new tests. Auto-spec gap caught at preflight: spec proposed an existing superset check that didn't exist; design doc reframed implementation against prior art (`feedback_auto_spec_gap`).
- **PR #1687** (`0af57494`) -- postmerge curation for #1667 + #1674 lessons. 8 lessons extracted, 1 compiled and archived inline (over-broad split-on-comma pattern). GCA pushback win on filename-prefix vs content-hash confusion + LEDGER_RETRY_PENDING_CODES omission policy.
- **PR #1688** (`9e3214e0`) → **1.15.7 published** -- closes #1664 (item 021). Self-suppressing-pattern reasonCode. New `'self-suppressing-pattern'` value added to `NonCompilableReasonCodeSchema` (engine-detected ledger superset, `compiler-schema.ts:198`), NOT to `CompilerOutputBaseSchema.reasonCode` (LLM-emittable enum). Architectural distinction codified: codes the LLM is taught to emit go in the LLM enum; codes detected post-LLM by engine guards go ONLY in the ledger superset. 5+ new tests. GCA pushback win on `CompilerOutputBaseSchema` vs `NonCompilableReasonCodeSchema` separation.
- **PR #1690** (`d1e0bc2a`) → **1.15.8 published** -- closes #1666 (item 024). `totem triage-pr` strict-by-id dedup using deterministic `rootCommentId`. 14 tests rewritten + 7 new. GCA pushback win (partial fix) on single-pass-vs-two-pass strategic decision + cross-bot independence symmetry.
- **Strategy submodule.** Took over Proposal 248 PR #136 ("Bot Operations Packs") and merged with my amendments (substrate-I-author boundary per `feedback_cross_stream_territory`). Strategy Claude shipped six parallel strategy PRs during the session: #137 (bot-nuance landed), #140 (Proposal 248 promoted), #141 (LC-20 items 025+026), #143 (ADR-091 Stage 4 decomposition + bot-nuance patterns + journals), #144 (1.16.0 roadmap), #145 (totem-lint cross-repo gate seal). Submodule pointer bumped to `f71033d` in PR #1693 (post-session refresh), closing the drift and picking up strategy PRs #147 (journal subdirs), #148 (upstream-feedback metadata sync), and #149 (.journal backfill, closes strategy#146).
- **Counts post-cut.** 444 compiled rules (379 active, 65 archived). 1,167 lessons on disk. Test counts ~3,237 post-1.15.8 (core 1,404 + cli 1,833; estimate -- run `pnpm --filter @mmnto/totem test` and `pnpm --filter @mmnto/cli test` for authoritative).
- **Citation-based GCA pushback: 4-for-4 this session, 100% concession rate.** Pattern reinforced past `project_gca_self_contradiction_pattern`: read actual code, write a citation-laden decline, GCA concedes. Auto-spec gap pattern recurring (#1665 / #1688 / #1690) -- captured in `feedback_auto_spec_gap`.
- **Tickets filed today.** 8 follow-ups: #1669 / #1670 / #1671 (applies-to ecosystem), #1678 / #1679 (scope-override strict-fail + prompt refinement), #1680 (Pipeline 1 audit), #1681 (severity-helper rethrow harden), #1691 (triage-pr `--no-dedup` flag + summary line + help docs).

**2026-04-24 PM** (1.15.4 patch cut) -- LC-velocity classifier improvements. Two compile-worker prompt fixes bundled.

- **PR #1652** (`3037591d`) -- Test-contract scope classifier (closes #1626). Compile-worker recognizes lessons whose hazard is behavior inside test files (assertion conventions, spy/mock contracts, test-fixture hygiene) and emits test-inclusive `fileGlobs` (`**/*.test.*`, `**/*.spec.*`, `**/tests/**/*.*`, `**/__tests__/**/*.*`) instead of the default `!**/*.test.*` exclusion. Three positive signals: `testing` tag, test-framework calls in examples, lesson-body references to test execution. False-positive trap guards against "API Contracts" / "Data Contracts" keyword-only triggers. Third prompt classifier after #1598 + #1634; same structural surface on both `COMPILER_SYSTEM_PROMPT` and `PIPELINE3_COMPILER_PROMPT`.
- **PR #1658** (`66e26da2`) -- Declared severity override (closes #1656). New `parseDeclaredSeverity(body)` helper in `@mmnto/totem` that normalizes prose-declared severity against common markdown / punctuation shapes (`**Severity:** error`, `**Severity: error**`, `Severity: **error**`, `Severity: error.`, `` `error` ``, combinations thereof). `buildCompiledRule` honors a `declaredSeverityOverride` option with post-LLM deterministic override; `BuildRuleResult.severityOverride` reports when the override changes the outcome, threaded through rejection paths too. New `onSeverityOverride` callback on `CompileLessonCallbacks` wired to a `writeSeverityOverrideTelemetry` closure in CLI `compile.ts` that records records tagged `type: 'severity-override'` to `.totem/temp/telemetry.jsonl`. Compile prompts gain a `Declared Severity` directive section; every Output Schema example and concrete Lesson → Output few-shot example now carries `"severity": "warning"` to reduce drift at source.
- **Strategy submodule bump.** `113179c` → `7892892b`. Picks up strategy PRs #125 (upstream-feedback items 015 + 016 from LC session-17 filed as totem#1656 + totem#1657) and #124 (upstream-feedback item 017 — three-layer language-support-gap addendum).
- **Counts.** 443 compiled rules (379 active, 64 archived). 1,156 lessons on disk. 966 `nonCompilable` entries. Corpus counts unchanged from 1.15.3; new tickets filed this session all target future work (α+β+γ Rust-support arc, retriage chore PR).
- **LC-queue state.** Two LC-blocking items shipped (#1626 scope inversion, #1656 severity drift). Remaining LC-focused tickets: α #1653 (engine dispatch) + β #1654 (Lang.Tsx hardcoding) bundled as the Rust-support substrate; #1657 (ReDoS module-path idiom docs); γ #1655 (per-language kinds). Retriage follow-up via `totem compile --upgrade <hash>` will correct the two test-contract rules (`"Normalize temp paths..."`, `"Spy on logger contracts..."`) and the five LC ADR-008 severity-mismatched rules; tracked as pending chore PR.
- **Bot-review tail.** #1658 burned 4 bot-review rounds (GCA R1 + CR R1 on parser strictness, CR R1 info on schema examples, GCA R2 on stripInlineCode order, CR R3 minor on rejection-path severityOverride). All findings addressed and acknowledged; the iterative-fix cycle validates the multi-shape prose normalization the feature targets.

**2026-04-23 PM** (1.15.3 patch cut) -- Compile-worker quality cluster + runtime ReDoS defense. Three feature PRs bundled.

- **PR #1639** (`daf65279`) -- `context-required` classifier on the compile-worker output schema. Lessons whose hazard is scope-bounded by a context the pattern cannot capture (e.g., `"sim.tick() must not advance inside _process"`) now route to the `nonCompilable` ledger instead of compiling into false-positive-prone rules. Introduces the narrow LLM-emittable `reasonCode` enum pattern on `CompilerOutputBaseSchema` that subsequent classifiers extend. New **Context Constraints Classifier** section on the compile prompt with anti-lazy guard: compilation MUST still succeed when `fileGlobs` / ast-grep `kind:` / `inside:` / `has:` / `regex:` combinators can express the constraint. Closes #1598.
- **PR #1640** (`ede49b01`) -- Bundle A: `semantic-analysis-required` classifier (#1634) + ledger hygiene (#1627). Extends the narrow enum with one consolidated `semantic-analysis-required` code covering four sub-classes (multi-file contracts, closure-body AST analysis, system-parameter-aware scoping, project-state-conditional semantics); sub-class in prose `reason`. Pipeline 2 + Pipeline 3 `!parsed.compilable` branches now use `parsed.reasonCode ?? 'out-of-scope'` so future narrow classifiers thread through without per-code switches. `LEDGER_RETRY_PENDING_CODES` set + `shouldWriteToLedger(reasonCode)` predicate exported from `@mmnto/totem`; CLI ledger guard rejects writes for retry-pending codes (smoke-gate transient failures) so they no longer permanently mark lessons as unfit. Symmetric stale-entry prune on both compiled branches. Cleaned 3 stale `matches-good-example` entries from the shipped ledger. Closes #1634 + #1627.
- **PR #1644** (`7da7d72d`) -- Bounded regex execution via persistent Node worker thread. `RegexEvaluator` class with per-rule-per-file timeout, `totem lint --timeout-mode <strict|lenient>` CLI flag (strict default, CI path). New `packages/core/src/regex-safety/` module (`evaluator.ts`, `worker.ts`, `apply-rules-bounded.ts`, `telemetry.ts`). Zod-validated telemetry (`type: 'regex-execution'`) appended to `.totem/temp/telemetry.jsonl` with repo-relative path redaction (paths outside the repo root become `<extern:<sha256-12>>`). Race-condition hardening baked in: `respawnPromise` coalesces concurrent respawn requests, `MAX_CONSECUTIVE_RESPAWNS` guards against infinite spawn loops on a permanently-broken worker, cold-start gate prevents the 100ms default from misfiring under CI load. Pre-exhibit defense against a ReDoS attack chain that survives every prior gate (`safe-regex` static check, bidirectional smoke gate, human promotion review). Closes #1641.
- **Documentation.** `docs/wiki/cli-reference.md` `totem lint` section extended to document the `--timeout-mode` flag and the distinction between the lint-time runtime budget and the input-time check on `totem add-secret --pattern`.
- **Counts post-cut.** 443 compiled rules (379 active, 64 archived). 1,156 lessons on disk. 966 `nonCompilable` entries (+7 since 1.15.2 cut from postmerges + the 3-entry stale cleanup in #1640).
- **Tickets filed across the 2026-04-23 arc.** 6 total: #1637 (review diff-visibility), #1638 (pnpm install warnings), #1641 (ReDoS, closed via #1644), #1642 (Trap Ledger mutation event), #1643 (lesson source-provenance), #1645 (`appendTelemetry` cwd vs configRoot, CR sibling of #1644 fix).

**2026-04-22 PM** (1.15.1 patch cut) -- Authoring commands + LC upstream triage closeout + strategy submodule catchup.

- **PR #1615** (`a5eb845c`) -- `totem proposal new <title>` + `totem adr new <title>` scaffolding (MVP per ticket #1288). New `packages/cli/src/utils/governance.ts` orchestrator with 5 helpers + 2 default templates matching the ADR-091 heading convention (`# ADR NNN: Title`). 34 new tests. Pack-agent-security allowlist updated for the 2 legitimate spawn sites the commands introduce. Patch-level changeset on disk (`1.15.1-proposal-adr-scaffolding.md`).
- **Postmerge for #1615.** 7 lessons extracted, 1 compiled, 1 archived inline (`8dbddb677f738249` over-broad `throw`-in-`catch` pattern -- sibling class to #1598 context-sensitive extraction gap; directly contradicted `lesson-fail-open-catch-ban`). 3 lessons skipped as architectural / non-compilable, 3 smoke-gated on goodExample over-matching. Archive script committed at `scripts/archive-bad-postmerge-1615.cjs`.
- **LC upstream triage batch.** 15-item handoff from Liquid City session-8 / session-9 dispatched today. 8 new totem tickets filed (#1617-#1624) spanning tier-2 substrate items (doc-cascade drift detector, `totem spec` short-circuit + directory-layout hallucination, `triage-pr --since`, numeric propagation sweep) and tier-3 workflow items. 3 cross-signal comments on existing tickets (#1598 item 8, #1555 item 9a, #1595 item 12). 4 strategy-surface items routed to `totem-strategy`: items 2 (invariants) and 4 (panel-audit) landed as Proposals 244 + 245; item 7 landed as the canonical ADR `TEMPLATE.md` with Implementation Migration Notes section; item 6 filed as strategy#109 (tier-3 investigation on styleguide / tenets / dataset triangle sync).
- **Strategy submodule bump.** `86b0fb0` -> `6acc855` picks up ADR-092 Memory Substrate (Accepted via #103), Proposal 244 (#104), ADR-090 amendment for bounded audit dispatch (#105), Proposal 245 (#106), `upstream-feedback/` directory bootstrap (#107), and the post-triage docs refresh + ADR TEMPLATE (#108).
- **Counts post-postmerge.** 441 compiled rules (378 active, 63 archived). 1,147 lessons on disk. 959 `nonCompilable` entries.
- **Tickets filed today.** 9 total: 8 totem (#1617-#1624) + 1 strategy (#109).

**2026-04-20 PM** (1.15.0 cut and published) -- Pack Distribution release shipped. All four ship-gate items merged; 1.14.14 through 1.14.17 patches landed across the day, then the minor bump.

- **PR #1604 (`e449910d`)** → 1.14.17 -- `totem doctor` grandfathered-rule advisory (part 2 of #1581). Surfaces the pre-zero-trust cohort (active rules without the ADR-089 `unverified` flag) categorized by `vintage-pre-1.13.0`, `no-badExample`, `no-goodExample`. Real-corpus output: 378 grandfathered rule(s): 358 vintage-pre-1.13.0, 371 no-badExample, 378 no-goodExample. Advisory-only (`warn`) diagnostic. ADR-091 Stage 4 Codebase Verifier (1.16.0, #1504) is the empirical audit path; the advisory gives users a triage surface until that ships. Closes #1603 + #1581.
- **PR #1606 (`dbe578a8`)** → **1.14.17 published** -- Version Packages auto-PR bundling #1603.
- **PR #1607 (`f9c287b1`)** -- Minor-level changeset. Documents Pack Distribution (`@mmnto/pack-agent-security`, `totem install pack/<name>`, `pack-merge` immutable-downgrade refusal, content-hash substrate), zero-trust default (ADR-089), compile hardening (ADR-088 Phase 1 plus two doctor advisories), compound ast-grep rules (ADR-087), positioning ADRs (ADR-085, ADR-090, ADR-091). GCA flagged `shield` vs canonical `review` in the notes (fixed); GCA also flagged `nonCompilable` 4-tuple terminology (declined: project-canonical per `compiler-schema.ts:238,267-269`).
- **PR #1608 (`a42f09d4`)** → **1.15.0 published** -- Version Packages auto-PR shipping 1.15.0. Publish workflow ran 50s. GCA flagged `"private": true` on `packages/pack-agent-security/package.json` (declined: deliberate pre-signing scaffolding per ADR-085; follow-up filed as #1609 blocked on #1492 Sigstore signing).
- **Tickets filed this session.** 4 total: #1603 (doctor advisory, shipped), #1605 (tier-3 defensive cleanup in `findStaleRules`), #1609 (tier-2 pack `private:false` gate blocked on #1492), plus follow-ups across the day.

**2026-04-20 AM/midday** (1.14.14 / 1.14.15 / 1.14.16 shipped) -- Compile-hardening trio sprint + LC feedback triage + ship-gate lock.

- **PR #1584 (`b7eb2951`)** -- Orphan command cleanup. Deleted seven dead source files (`briefing.ts`, `bridge.ts`, `audit.ts` plus their `.test.ts` / `-templates.ts` siblings). Fixed the shipped Gemini `SessionStart.js` hook that had been failing with "unknown command 'briefing'" since PR #755 (2026-03-20). Closes #1583.
- **PR #1585 (`e073dc00`)** -- `totem review --auto-capture` flipped to opt-in. Pipeline 5 auto-capture defaults to OFF; the flag was `--no-auto-capture` and had been opt-out since 1.14.1. Liquid City Session 6 audit measured 8-rule wave across 5 review invocations producing 13 `totem lint` warnings under the old default. Closes #1579.
- **PR #1588 (`c8c03b7d`)** -- Postmerge lessons for #1584 + #1585. 6 lessons extracted (5 classified nonCompilable, 1 compiled). Archived `501000ab9c41230b` inline for over-matching. Added idempotent `scripts/archive-bad-postmerge-1584-1585.cjs` hardened across 3 bot-review rounds (try/catch JSON parse, hash-collision guard, archivedReason refresh, prefix parity).
- **PR #1591 (`89ca8904`)** -- `goodExample` over-matching check. `CompilerOutputSchema.goodExample` flipped from optional to engine-conditional required (regex + ast-grep); the smoke gate now runs both directions so a rule that fires on both its bad and good examples is rejected as `matches-good-example`. Two new reason codes: `matches-good-example` + `missing-goodexample`. Pipeline 3 threads `snippets.good` via `goodExampleOverride`; Pipeline 2 requires LLM emission via updated compiler prompt. Schema + gate both use `.trim().length > 0` so whitespace-only snippets cannot slip through as "valid" with zero coverage (CR round-1 major finding; badExample hole from #1409 closed symmetrically). Closes #1580.
- **PR #1592 (`c025a41b`)** -- Version Packages auto-PR shipping 1.14.15 with #1580's changeset.
- **Tickets filed this session.** 10 total: #1587 (manifest drift, dedupe for LC items 7 + 8), #1589 (`CompiledRuleSchema` missing `archivedAt` silent-strip), #1590 (init.test.ts Windows flake, tier-3), #1593 (bot-review parser covering 3 blindspots: CR outside-diff + nit-nesting + GCA inline-fallback), #1594 (iterative review docs), #1595 (`verify_execution` default post-amend), #1596 (`type: 'reference'` schema, Proposal 233 Gap 5 intersection), #1597 (agent workflow PR-page spot-check, companion to #1593), #1598 (compile-worker context-sensitive lesson extraction gap, LC items 9 + 10). Two strategy items (#1595, #1596) flagged for Gemini.
- **Ship-gate lock (see "1.15.0 Ship Gate" section).** Original four-ticket plan revised to three after in-session pressure-testing with Gemini surfaced a dependency inversion: #1504's audit gates assume substrate fields the legacy corpus does not have. #1504 moved to 1.16.0 behind ADR-091 Stage 4 Codebase Verifier.

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
- **Phase B first PR shipped.** `#1503` merged 2026-04-16 scaffolding `@mmnto/pack-agent-security` (the ADR-089 flagship pack). Empty rules array shape matches `CompiledRulesFileSchema`, `.totemignore` template, README with honest coverage boundaries, 6 unit tests pinning structural invariants. `.` root export added to `package.json` during review for strict ESM resolution. Also archives rule `939ae83ed3bf28bb` inline (over-broad fileGlob on all `compiled-rules.json` files blocked the pack from shipping its own seed manifest) and rule `e2341ed9229f9a60` inline (incidental compile with pattern `new $ERROR($$$ARGS)` that matches every class instantiation, not just error wrapping). Both archives carry explicit reasons citing the bot reviews that caught them.
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

### Shipped: 1.15.0 — The Distribution Pipeline (2026-04-20)

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute. All four ship-gate items merged; `@mmnto/cli@1.15.0`, `@mmnto/totem@1.15.0`, `@mmnto/mcp@1.15.0` on npm.

#### Ship-gate completion

| Slot | Ticket                                                              | Status            | Ship              |
| ---- | ------------------------------------------------------------------- | ----------------- | ----------------- |
| 1    | **#1580** smoke-gate `goodExample` over-matching check              | Merged (PR #1591) | 1.14.15           |
| 2    | **#1589** `CompiledRuleSchema` missing `archivedAt` silent-strip    | Merged (PR #1599) | 1.14.16           |
| 3    | **#1581 part 1** zero-trust default + `totem rule promote` CLI      | Merged (PR #1601) | 1.14.16           |
| 4    | **#1581 part 2** grandfathered-rule advisory                        | Merged (PR #1604) | 1.14.17           |
| —    | `@mmnto/pack-agent-security` ≥ 5 immutable rules with test fixtures | Verified          | 5 rules, 57 tests |

The 2026-04-20 dependency-inversion discovery moved **#1504** (post-ADR-088 legacy corpus audit) to 1.16.0 behind ADR-091 Stage 4 Codebase Verifier: 357 of 378 active rules (94%) are pre-1.13.0 with zero `badExample` / `goodExample` / `unverified` substrate coverage, and #1504's Phase 1 gates assume those fields. The Codebase Verifier runs rules empirically against actual code and does not depend on the snippet fixtures the legacy cohort lacks.

#### Deferred follow-ups (unmilestoned, pick up between cycles)

- **#1582** (`totem spec` path-existence guard). Cheap, opportunistic; next-cycle bundle candidate.
- **#1587** (archive-in-place durability: manifest output-hash drift + `--force` silent-overwrite + `totem lesson archive <hash>` atomic command + skill doc update).
- **#1590** (init.test.ts Windows CI flake). Tier-3.
- **#1593** (bot-review parser: CR outside-diff + nit-nesting + GCA inline-fallback blindspots). Tier-2.
- **#1594** (iterative review docs for large-scope PRs). Tier-3.
- **#1595** (`verify_execution` as default post-amend hook). Tier-3, ADR-090 adjacent, routed to Gemini.
- **#1596** (`type: 'reference'` indexing schema). Tier-2, Proposal 233 Gap 5 intersection, routed to Gemini.
- **#1597** (agent-workflow PR-page spot-check, companion to #1593). Tier-3 docs.
- **#1598** (compile-worker context-sensitive lesson extraction gap). Tier-2.
- **#1600** (signoff skill filename template). Tier-3 docs.
- **#1605** (drop defensive `?? lessonHash` fallback from `findStaleRules`). Tier-3.
- **#1609** (flip `packages/pack-agent-security/package.json` `private: false` when #1492 Sigstore signing lands). Tier-2, blocked on #1492.
- **#1669 / #1670 / #1671** (applies-to ecosystem: function-role classifier, bot-prompt integration, lesson backfill). Tier-3.
- **#1678 / #1679** (scope-override strict-fail + prompt refinement). Tier-3, telemetry-driven.
- **#1680** (Pipeline 1 audit). Tier-3.
- **#1681** (severity-helper rethrow harden -- pairs with #1688's selective-rethrow pattern). Tier-3.
- **#1691** (`triage-pr` `--no-dedup` flag + summary line + help docs). Tier-3.

#### Undecomposed ADR backfill candidates

Strategy-pair 2026-04-16 audit identified 22 Accepted ADRs with zero ticket citations; 16 are buildable. Five highest-leverage (all touch pack + ingestion paths):

- **ADR-004** — AST-Aware Git Diff Analysis (Tree-sitter line-mapping + scope field on compiled rules).
- **ADR-015** — Zero-Config Architectural Detection (5-stage fingerprinting).
- **ADR-017** — Vector Cache Invalidation & Data Drift (hash-based staleness for LanceDB).
- **ADR-025** — `totem doctor` Diagnostic Architecture.
- **ADR-039** — Deterministic Briefing & Handoff.

### Current: 1.16.0 — Ingestion + Substrate DX

**Theme:** Deterministic architectural enforcement through the ADR-091 five-stage ingestion funnel (`Extract → Classify → Compile → Verify-Against-Codebase → Activate`) paired with the ADR-090 Human DX and Agent AX tracks. Source diversity (GHAS, lint, ADRs) plus the verifier that makes empirically-grounded rule generation safe.

#### Headline work — Ingestion (ADR-091 funnel)

- [ ] **Classifier gate (Stage 2):** Routes candidates into Compile vs Candidate Debt per ADR-091. Strategy-side implementation ticket pending decomposition.
- [ ] **ADR-091 Stage 4 Codebase Verifier:** Runs compiled candidate against a baseline snapshot before Activate. Headline 1.16.0 substrate; does not depend on `badExample` / `goodExample` snippet fixtures so it can validate the legacy corpus empirically. Decomposed by strategy Claude into **totem#1682 / #1683 / #1684 / #1685 / #1686** during the 2026-04-25/26 session (strategy PR #143).
- [ ] **#1504** post-ADR-088 audit of pre-1.13.0 rule corpus (357 active rules). Moved here from the 1.15.0 ship gate per the 2026-04-20 dependency-inversion discovery. Expected archive rate 30-50% of the grandfathered cohort.
- [ ] **GHAS / SARIF Extraction** (Strategy #50). Convert GitHub Advanced Security alerts into Totem lessons. ADR-086 External Alert Ingestion gates this.
- [ ] **Lint Warning Extraction** (Strategy #51 ↔ totem#1253 `totem extract-lint`). Convert ESLint / Semgrep / Sonar warnings into actionable lessons.
- [ ] **ADR-mining extractor.** Decision-record ingestion into the same funnel. Strategy-side implementation ticket pending decomposition.

#### Headline work — ADR-090 Substrate DX

- [ ] **#1497** — rich `describe_project` MCP endpoint. Drops session-start briefing from ~5 tool calls to 1. Agent AX track.
- [ ] **#1498** — `totem init` auto-detects Cursor / Windsurf / Claude Code and injects MCP config. Human DX track. Supersedes closed #124 and #129.

#### Bundled cleanup / validation

- [ ] **#1226** SARIF upload hex escape fix — load-bearing for the new SARIF ingestion path.
- [ ] **Governance eval harness** (Strategy #17) — validates that ingested rules actually catch what GHAS / lint flagged.

#### Carried over from 1.15.0 quarantines

- Proposal 217 (LLM context caching). Compile-pipeline substrate; quarantined out of 1.15.0 to avoid distribution-feature-on-substrate-change silent regressions.

#### Proposal dispositions (updated 2026-04-20)

- **Promoted to Accepted ADR:** 202 → ADR-088, 228 → ADR-089, 234 → ADR-091. Plus ADR-085, ADR-087, ADR-090 accepted across the 1.15.0 cycle.
- **Archived:** `preflight-v2.md` (2026-04-15) plus 8 obsolete proposals archived during the 2026-04-19 full corpus audit.
- **Lock at 1.17.0 with open-question iteration first:** Proposal 230 (content-hash embedding cache).
- **Decompose as tickets now:** Proposal 191 vectors A+B (JIT bot prompts, trap-ledger pruning). Vector C (semantic LSP) stays Horizon 3+.
- **Split into two tickets:** Proposal 229 (TBench spot-check near-term, full harness Horizon 3).
- **Formalize decision gate before further work:** Proposal 227 (multi-axis platform strategy).
- **Stay parked:** 218 (governance fine-tuning, Horizon 3), 231 (P2P Iroh, Horizon 3+).

#### Tier-1 drain queue (post-1.15.0)

- **#1432** add_lesson concurrency
- **#1435** CompilerOutputSchema round-trip
- **#1431** MarkdownChunker YAML
- **#1555 / #1556 / #1557** totem spec correctness
- **#1569 / #1570 / #1572** compile-worker durability cluster
- **#1504** pre-1.13.0 legacy corpus audit (now attached to the Codebase Verifier above)
- **#1226** SARIF hex escape (already listed under Bundled cleanup)

#### Watch-outs

- **Substrate separation.** Do not change compile-pipeline substrate (Proposal 217 context caching, Proposal 230 embedding cache) in the same release as the features built on top of it.
- **Incidental compiles during manifest refresh.** `totem compile` refreshes `compile-manifest.json` and also compiles any ready lessons, which can ship an over-broad rule. The ADR-088 Phase 1 #1479 verify-retry prevents the class; archive inline if one slips.

#### Other pending work (unmilestoned, unblock between cycles)

- **#1414** Pipeline 1 smoke gate flip after 136-lesson Bad Example backfill. Mechanism shipped in #1415; hard enforcement deferred until the curation sweep.
- **#1419** Cryptographic attestation for the Trap Ledger (SOX compliance gap). Tier-3. Closes the gap in Proposal 225's enterprise pitch where the ledger was claimed as "cryptographically logged" but is currently a flat append-only file.

### Backlog (Horizon 3+)

- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

_Note on `#1504`: moved out of Horizon 3+ into the **1.16.0 "ADR-091 Stage 4 Codebase Verifier and the legacy corpus audit"** section above. The #1479-#1483 hard-block from the original 2026-04-16 filing is obsolete (those shipped in 1.14.12); the actual prerequisite is ADR-091 Stage 4 per the 2026-04-20 dependency-inversion discovery._

### Recently Completed

**1.15.0 — Pack Distribution (2026-04-20)**

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute. Full release-notes body: `.changeset/` CHANGELOG entry (synthesized into `CHANGELOG.md` on publish).

- **Pack Distribution:** `@mmnto/pack-agent-security` flagship pack (5 immutable security rules), `totem install pack/<name>`, `pack-merge` immutable-downgrade refusal, content-hash substrate.
- **Zero-trust default (ADR-089):** Pipeline 2 + Pipeline 3 LLM rules ship `unverified: true` unconditionally; `totem rule promote <hash>` atomic activation CLI.
- **Compile hardening (ADR-088 Phase 1):** Layer 3 verify-retry, bidirectional smoke gate (`badExample` + `goodExample`), `archivedAt` round-trip preservation, 9-value reason-code enum, two new `totem doctor` advisories (stale + grandfathered).
- **Platform:** Compound ast-grep rules (ADR-087), Windows `safeExec` shell-injection fix, Cross-Repo Context Mesh, standalone binaries.
- **Positioning:** ADR-090 (Multi-Agent State Substrate), ADR-091 (5-stage ingestion funnel), ADR-085 (Pack Ecosystem, five deferred decisions resolved).

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

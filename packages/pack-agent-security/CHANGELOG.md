# @totem/pack-agent-security

## 1.15.10

### Patch Changes

- 4bb87e2: `totem review` operator-dogfood bundle: override stamps the push-gate cache, plus an explicit `--diff <ref-range>` flag.
  - **mmnto-ai/totem#1716** — `totem review --override <reason>` now writes `.totem/cache/.reviewed-content-hash` after recording the override, so the push-gate hook unblocks immediately. Closes the tribal-knowledge `git reset --soft HEAD~1 && totem review --staged` workaround used since the override flag was added. New `recordShieldOverride` helper bundles the trap-ledger write and content-hash stamp into a single call site exercised by both the V2 structured-verdict path and the V1 fallback.
  - **mmnto-ai/totem#1717** — adds `totem review --diff <ref-range>` for explicit diff scope (e.g. `--diff HEAD^..HEAD`, `--diff main...feature`). Bypasses the implicit working-tree → staged → branch-vs-base fallback. The chosen diff source is logged to stderr (`Diff source: explicit-range`, `staged`, `uncommitted`, or `branch-vs-base`) so the operator's mental model matches the actual git invocation. Diffs exceeding 50,000 chars now surface a fail-loud truncation warning at the resolution layer — before the LLM call — so the operator can re-run with a narrower range instead of paying for a degraded review. The flag is documented in `--help`'s "Diff resolution" section. New `getGitDiffRange(cwd, range)` core helper rejects flag-injection ranges (leading `-`) and empty values; arg-array `safeExec` invocation prevents shell-metachar interpretation.

## 1.15.9

## 1.15.8

## 1.15.7

## 1.15.6

## 1.15.5

## 1.15.4

### Patch Changes

- d295439: 1.15.4 bundles two compile-worker prompt classifier improvements that surfaced from downstream consumer friction on `mmnto-ai/liquid-city`. Both close fidelity gaps between the lesson prose authors wrote and the compiled rule that shipped.

  ## Test-contract scope classifier (closes #1626)
  - New `### Test-Contract Scope Classifier (mmnto-ai/totem#1626)` section on both `COMPILER_SYSTEM_PROMPT` and `PIPELINE3_COMPILER_PROMPT`. Teaches the compile-worker to recognize lessons whose hazard is **behavior inside test files** (assertion conventions, spy / mock contracts, test-fixture hygiene) and emit test-inclusive `fileGlobs` instead of the default `!**/*.test.*` exclusion.
  - Three positive signals classify a lesson as test-contract: the `testing` tag, test-framework calls in `badExample`/`goodExample` (`describe(`, `it(`, `test(`, `expect(`, `vi.mock(`, `jest.mock(`, `beforeEach(`, `afterEach(`, `vi.spyOn(`, `jest.spyOn(`), or lesson-body references to test-execution-specific behavior.
  - Broad test-inclusive glob set for test-contract rules: `["**/*.test.*", "**/*.spec.*", "**/tests/**/*.*", "**/__tests__/**/*.*"]`. Narrow test-scoped globs (e.g., `packages/e2e/**/*.spec.ts`) are preserved when the lesson clearly targets them.
  - False-positive trap guard: the word "contract" alone does NOT classify a lesson as test-scoped. Lessons titled "Define strict API Data Contracts" or "Versioning contracts for REST endpoints" describe application-surface invariants. Classification requires the `testing` tag OR test-framework code in the examples alongside any keyword match.

  **Downstream impact:** Two `liquid-city` rules (`"Normalize temp paths for cross-platform equality"`, `"Spy on logger contracts in tests"`) were shipping with scopes that excluded tests and silently never fired. A follow-up chore cycle (`totem compile --upgrade <hash>` per rule) retriages existing corpus against the new prompt.

  ## Declared severity override (closes #1656)
  - New `parseDeclaredSeverity(body: string)` helper exported from `@mmnto/totem`. Parses `**Severity:** error` / `Severity: warning` prose declarations from a lesson body and returns a normalized `'error' | 'warning' | undefined`. Tolerates common markdown and punctuation shapes: bold markers (`**`, `*`, `_`) on either side, backtick-wrapped values, trailing sentence punctuation (`.`, `,`, `;`, `:`, `!`, `?`), and combined shapes like `**Severity: error**.`. Strict enum equality follows the strip, so out-of-vocabulary tokens (`info`, `critical`) return `undefined`.
  - `buildCompiledRule` honors a new `declaredSeverityOverride` option on `BuildCompiledRuleOptions`. Post-LLM override wins over `parsed.severity` regardless of LLM emission. Marker fires in `BuildRuleResult.severityOverride` only when the override actually changed the outcome (declared value differs from `emittedSeverity ?? 'warning'`). Marker is threaded through rejection paths too, so telemetry captures prompt-drift even when the rule fails for other reasons.
  - New `onSeverityOverride` callback on `CompileLessonCallbacks` fires when the override changes the emitted severity. CLI `compile.ts` wires a `writeSeverityOverrideTelemetry` closure that appends records tagged `type: 'severity-override'` to `.totem/temp/telemetry.jsonl` via the cwd-aware `totemDir` (matches the `mmnto-ai/totem#1645` pattern). Fire-and-forget; sink failures do not interfere with compile results.
  - New `### Declared Severity (mmnto-ai/totem#1656)` directive section on both compile prompts instructs the LLM to honor prose-declared severity in its emitted JSON. Every Output Schema example and every concrete Lesson → Output few-shot example now carries `"severity": "warning"` (the default) to reduce drift at source.

  **Downstream impact:** Five `liquid-city` ADR-008 rules on PR 77 burned ~10 manual severity-edit commits across R2 + R3 rounds because the compile pipeline emitted `"severity": "warning"` despite lesson prose declaring `Severity: error`. The mechanical re-edit loop closes; the next `totem lesson compile` cycle on LC emits declared severity directly.

  ## Strategy submodule bump
  - `.strategy` submodule pointer advances from `113179c` to `7892892b`. Picks up strategy PR #125 (upstream-feedback items 015 + 016 from liquid-city session-17) and strategy PR #124 (upstream-feedback item 017 — three-layer language support gap addendum that documents the architectural surface of the pending Rust-support arc).

## 1.15.3

### Patch Changes

- b782d4e: 1.15.3 bundles three compile-worker quality fixes and the runtime ReDoS defense. All three extend the ADR-091 Classify stage or harden the deterministic-enforcement path under `totem lint`.

  ## Bounded regex execution (closes #1641)
  - Runtime per-rule-per-file timeout on regex evaluation via a persistent Node worker thread. Catastrophic-backtracking patterns now terminate at the configured budget instead of hanging `totem lint`. Pre-exhibit defense against a ReDoS attack chain that survives every prior gate (`safe-regex` static check, bidirectional smoke gate, human promotion review).
  - `totem lint --timeout-mode <strict|lenient>` — new flag on the lint command. `strict` (default) fails non-zero on any timeout; `lenient` skips the offending rule-file pair with a visible warning. Strict mode is the CI path.
  - New `packages/core/src/regex-safety/` module (`evaluator.ts`, `worker.ts`, `apply-rules-bounded.ts`, `telemetry.ts`). Async `applyRulesToAdditionsBounded` sibling to the sync path, policy-free — returns `{violations, timeoutOutcomes}` and lets the CLI apply strict-vs-lenient exit-code policy.
  - Telemetry: every terminal outcome (match, no-match, timeout, syntax error) writes a `type: 'regex-execution'` record to `.totem/temp/telemetry.jsonl`, Zod-validated against `RegexTelemetrySchema` with repo-relative path redaction (paths outside the repo root become `<extern:<sha256-12>>`).
  - Race-condition hardening baked in: `respawnPromise` coalesces concurrent respawn requests, `MAX_CONSECUTIVE_RESPAWNS` guards against infinite spawn loops on a permanently-broken worker, and a cold-start gate prevents the 100ms default from misfiring under CI load.

  ## Context-required classifier (closes #1598)
  - New `reasonCode: 'context-required'` route on the compile-worker output schema. Lessons whose hazard is scope-bounded by a context the pattern cannot structurally capture (e.g., `"sim.tick() must not advance inside _process"`) now route to the `nonCompilable` ledger instead of compiling into false-positive-prone rules.
  - Narrow LLM-emittable enum on `CompilerOutputBaseSchema.reasonCode` (not the full `NonCompilableReasonCodeSchema`), preventing the LLM from forging internal codes like `verify-retry-exhausted`. Extends ADR-091's Classify stage.
  - New **Context Constraints Classifier** section on the compile prompt with marker heuristics (inside / when / only-for-new / must-not) and an explicit **anti-lazy** rule-of-thumb: compilation MUST still succeed when `fileGlobs` / ast-grep `kind:` / `inside:` / `has:` / `regex:` combinators can express the guard.

  ## Semantic-analysis classifier + ledger hygiene

  Closes #1634 + #1627.
  - Extends the narrow `reasonCode` enum with `'semantic-analysis-required'` covering four sub-classes: multi-file contracts, closure-body AST analysis, system-parameter-aware scoping, project-state-conditional semantics. Sub-class carried in the prose `reason`; one consolidated code keeps the LLM contract tight.
  - Pipeline 2 and Pipeline 3 `!parsed.compilable` branches switch from per-code conditional checks to `parsed.reasonCode ?? 'out-of-scope'`. Future narrow classifiers thread through without per-code switches.
  - `LEDGER_RETRY_PENDING_CODES` set + `shouldWriteToLedger(reasonCode)` predicate exported from `@mmnto/totem`. CLI ledger guard now rejects writes for retry-pending codes (`pattern-syntax-invalid`, `pattern-zero-match`, `verify-retry-exhausted`, `missing-badexample`, `missing-goodexample`, `matches-good-example`) so transient smoke-gate rejections no longer permanently mark lessons as unfit.
  - Symmetric stale-entry prune on both compiled branches (local + cloud) when a lesson compiles cleanly, and on cloud smoke-gate rejection. Cleaned three stale `matches-good-example` entries from the shipped ledger.

## 1.15.2

### Patch Changes

- 1c766c2: 1.15.2 ships the archive-in-place durability substrate from #1587 and the new `totem lesson archive` atomic command.

  ## Governance durability (closes #1587)
  - `totem lesson compile --refresh-manifest` — new no-LLM primitive that recomputes `compile-manifest.json` output_hash from the current `compiled-rules.json` state. Closes the postmerge inline-archive gap where the no-op compile path only detected input-hash drift. Strict exclusivity with `--force`.
  - `totem lesson compile --force` now preserves `status`, `archivedReason`, and `archivedAt` additively on rules whose `lessonHash` survives to the new output. Transient compile failures (network / rate-limit / manual reject / example-verification / cloud parse) leave the old rule intact instead of silently dropping it. Implemented via the new `preserveLifecycleFields` helper in core and `upsertRule` / `removeRuleByHash` helpers in the CLI compile loop (replace-by-hash on success; remove-on-skipped; unchanged on failed / noop). Dangling-archive guard preserved — rules whose source lesson was deleted are never resurrected.
  - `totem lesson archive <hash> [--reason <string>]` — new atomic command mirroring `totem rule promote`. Flips the rule's `status` to `archived`, stamps `archivedAt` on first transition, preserves `archivedAt` on reruns, refreshes the manifest, and regenerates copilot + junie exports — all in one call. Matches prefix on `lessonHash`; duplicate-full-hash collisions surface as data-corruption errors distinct from prefix ambiguity.
  - `/postmerge` skill doc rewritten to call `totem lesson archive` directly, retiring the hand-rolled `scripts/archive-bad-postmerge-*.cjs` pattern.

## 1.15.1

### Patch Changes

- e69edb2: 1.15.1 ships the `totem proposal new` and `totem adr new` scaffolding commands that close out #1288.

  ## Governance authoring (closes #1288)
  - `totem proposal new <title>` scaffolds a new strategy proposal at `.strategy/proposals/active/NNN-kebab-title.md` with the canonical template (Status / Author / Date / Milestone + Motivation / Problem Statement / Proposed Solution / Consequences / Decision Needed).
  - `totem adr new <title>` scaffolds a new ADR at `.strategy/adr/adr-NNN-kebab-title.md` with the Format B convention (`# ADR NNN: Title`, Status / Context / Decision / Consequences).
  - Both commands auto-increment the number by scanning the target directory, collision-check before any disk writes, and warn-and-continue on post-scaffold hooks so partial failures do not leave orphan files.
  - Runs `pnpm run docs:inject` automatically when the project has that script configured, so the `PROPOSAL_INBOX` and `ADR_TABLE` dashboards in README.md refresh without manual intervention.
  - New orchestrator at `packages/cli/src/utils/governance.ts` with 5 helpers and 2 default templates. 34 new tests covering slug validation, collision detection, number inference, template selection, and hook degradation.
  - `@totem/pack-agent-security` allowlist updated for the 2 legitimate `spawn` sites the new commands introduce.

## 1.15.0

### Minor Changes

- f9c287b: 1.15.0 ships Pack Distribution: the first shippable Totem pack, plus the compile-hardening and zero-trust substrate that makes packs safe to distribute.

  ## Pack Distribution
  - `@totem/pack-agent-security` (ADR-089 flagship pack). 5 immutable security rules covering unauthorized process spawning, dynamic code evaluation with non-literal arguments, network exfiltration via hardcoded IPs or suspicious domains (API + shell-string variants), and obfuscated string assembly via byte-level primitives. Every rule ships `immutable: true` + `severity: error` + `category: security` with bad/good fixture pairs and 57 unit tests.
  - `totem install pack/<name>` command installs a published pack into the local manifest.
  - `pack-merge` primitive refuses downgrade of immutable rules to warning or archived; bypass attempts log to the Trap Ledger.
  - Content-hash substrate across TypeScript and bash (review + sync + pre-push hook) so pack integrity verifies without relying on file timestamps.

  ## Zero-trust default (ADR-089)
  - Pipeline 2 and Pipeline 3 LLM-generated rules now ship `unverified: true` unconditionally. Activation via the atomic `totem rule promote <hash>` CLI or the ADR-091 Stage 4 Codebase Verifier in 1.16.0.
  - Pipeline 1 (manual) keeps its conditional semantics; human-authored rules are self-evidencing.

  ## Compile hardening (ADR-088 Phase 1)
  - Layer 3 verify-retry loop: rules that fail their own smoke test re-prompt once before the compiler rejects them.
  - Compile-time smoke gate runs both `badExample` and `goodExample`; rules that fire on both directions are rejected with reason code `matches-good-example` (closes the over-matching hole that drove the 2026-04-18 security-pack 10-of-10 archive rate).
  - `archivedAt` timestamp preserved across schema round-trips so the institutional first-archive-provenance ledger survives every compile cycle.
  - `unverified` flag and `nonCompilable` 4-tuple with 9-value reason-code enum replaces the opaque 2-tuples.
  - `totem doctor` stale-rule advisory (ADR-088 Phase 1) plus the grandfathered-rule advisory that surfaces the pre-zero-trust cohort categorized by `vintage-pre-1.13.0`, `no-badExample`, and `no-goodExample`.

  ## Platform
  - Compound ast-grep rules (ADR-087, promoted from Proposal 226). `astGrepYamlRule` field on `CompiledRule` with mutual exclusion on `astGrepPattern`, structural combinators (all / any / not / inside / has / precedes / follows), and canonical-serialization hashing via `canonicalStringify`.
  - Windows shell-injection fix in `safeExec` via `cross-spawn.sync` (closes a three-week-latent vector).
  - Cross-Repo Context Mesh (`totem search` federation + `totem doctor` Linked Indexes health check).
  - Standalone binary distribution unblocked (darwin-arm64, linux-x64, win32-x64).

  ## Positioning
  - **ADR-090 (Multi-Agent State Substrate).** Scopes Totem as the shared state, enforcement, and audit substrate for multi-agent development. Totem does not own agent routing, capability negotiation, session lifecycle, or live-edit conflict resolution. Future feature admission passes the Scope Decision Test.
  - **ADR-091 (Ingestion Pipeline Refinements).** Redefines the 1.16.0 ingestion pipeline as a 5-stage funnel: Extract → Classify → Compile → Verify-Against-Codebase → Activate. Renames the legacy `allowlist` terminology to `baseline`.
  - **ADR-085 (Pack Ecosystem).** Accepted with five deferred decisions resolved: Behavioral SemVer with refinement classification, array-order precedence plus `totem doctor` shadowing warning, Local Supreme Authority with ADR-089 immutable-severity carve-out, Sigstore + in-toto signing, native npm lifecycle with 72-hour unpublish constraint.

  Detailed patch-level changes: CHANGELOG.md entries 1.14.1 through 1.14.17.

## 1.14.17

## 1.14.16

### Patch Changes

- b7f298c: Ship the ADR-089 zero-trust default and the `totem rule promote` CLI (mmnto-ai/totem#1581, part 1 of 2).

  **Zero-trust default (core):** every LLM-generated rule now ships `unverified: true` unconditionally. Pipeline 2 (verify-retry loop) and Pipeline 3 (Bad/Good example-based) both flip from the pre-#1581 conditional behavior (keyed on Example Hit presence) to unconditional. Pipeline 1 (manual) keeps its pre-#1581 conditional semantics because manual rules are human-authored and self-evidencing; the existing Pipeline 1 Example-Hit guard stays as a safety net.

  Rationale: the LLM cannot self-certify structural invariants. Example Hit/Miss is an LLM-produced artifact of the compile process, not a human sign-off. Activation requires either human promotion via the new CLI below OR the ADR-091 Stage 4 Codebase Verifier in 1.16.0 (which validates rules empirically against actual code, not against LLM-generated snippet fixtures).

  **`totem rule promote <id>` CLI:** flips a rule's `unverified: true` flag to absent (canonical "verified" state), atomically refreshes `compile-manifest.json`'s `output_hash` so `verify-manifest` passes on the next push. Refuses to promote archived rules and refuses when the target rule is already verified. Exits 1 on ambiguous prefix matches with a disambiguation list.

  Hand-editing `compiled-rules.json` to flip `unverified` would break the manifest hash and trip the pre-push `verify-manifest` gate. The promote command is the blessed path; the atomic refresh closes that user trap at source.

  **Scope split:** the "Option 1 + Categorized Advisory" plan locks the 1.15.0 ship gate via this PR. The categorized `totem doctor` advisory that surfaces the 357 grandfathered pre-1.13.0 rules by reason lands as a follow-up PR on a separate branch to keep the reviewable surface tight.

  Closes #1581 (part 1).

- 358336e: Add `archivedAt` to `CompiledRuleBaseSchema` so Zod stops silently stripping it on round-trips (mmnto-ai/totem#1589).

  Pre-#1589, the schema declared `status`, `archivedReason`, `badExample`, `goodExample`, and a half-dozen other lifecycle fields — but not `archivedAt`. Zod's default behavior strips unknown keys during parse/serialize. Every compile-write cycle that round-tripped `compiled-rules.json` through `CompiledRulesFileSchema.parse()` silently erased prior `archivedAt` values from archived rules. Postmerge archive scripts (`scripts/archive-postmerge-*.cjs`) set the field via raw JSON mutation; it survived on disk until the next `totem lesson compile --export` quietly rewrote the file. Observed on PR #1588 (rule `4b091a1bc7d286d6`, archived 2026-04-19, timestamp lost during postmerge re-export). GCA caught the drop and we restored the timestamp manually; this ticket prevents future losses at the schema level.

  The field is declared `z.string().optional()` for backward compatibility with pre-#1589 manifests that never had the field populated. Existing call sites continue to work unchanged.

  Four new tests in `compiler-schema.test.ts` pin the invariant: accepts a rule with `archivedAt` set, preserves the field across a full parse → serialize → parse round-trip, tolerates an active rule without the field, and preserves the full archive tuple (`status` + `archivedReason` + `archivedAt`) together.

  Closes #1589.

## 1.14.15

### Patch Changes

- 89ca890: Extend the compile-time smoke gate with an over-matching check via `goodExample` (mmnto-ai/totem#1580).

  The gate now verifies both directions: the rule MUST match its `badExample` (under-matching check, in place since #1408) AND MUST NOT match its `goodExample` (over-matching check, new). A rule that fires on both sides is over-broad and produces false positives on every lint run, which was the dominant defect class observed in the 2026-04-18 security-pack postmerge incident (10-of-10 bad rate from #1526).

  `CompilerOutputSchema.goodExample` flips from optional to engine-conditional required for regex and ast-grep engines, mirroring the #1420 flip for `badExample`. The `ast` engine (Tree-sitter S-expression queries) remains exempt because the smoke gate does not yet evaluate those. `CompiledRuleSchema.goodExample` stays optional on the persisted-rule boundary for backward compat with pre-#1580 rules.

  Two new reason codes added to `NonCompilableReasonCodeSchema`: `matches-good-example` (over-match rejection) and `missing-goodexample` (defensive path for callers that bypass the schema refine). Rejected lessons surface in the `nonCompilable` ledger with the correct code so `totem doctor` and downstream telemetry can distinguish over-match rejections from other skip categories.

  Pipeline 3 automatically threads the lesson's Good snippet through as `goodExampleOverride`; Pipeline 2 requires the LLM to emit `goodExample` alongside `badExample` via the updated compiler prompt. Pipeline 1 (manual) is unaffected — the gate is opt-in via `enforceSmokeGate`.

  Closes #1580.

## 1.14.14

### Patch Changes

- e073dc0: Flip Pipeline 5 auto-capture on `totem review` from opt-out to opt-in.

  `--no-auto-capture` is renamed to `--auto-capture`; the default is now OFF. Observation rules captured from review findings are context-less (regex drawn from the flagged line, message taken from the reviewer, `fileGlobs` scoped to the whole codebase) and routinely pollute `compiled-rules.json` with rules that fire on unrelated files. The Liquid City Session 6 audit measured an 8-rule wave across 5 review invocations producing 13 new warnings on the next `totem lint`, up from 0.

  To preserve the old behavior, pass `--auto-capture` explicitly. Auto-capture will resume as a default once ADR-091 Stage 2 Classifier + Stage 4 Codebase Verifier ship in 1.16.0 and the LLM-emitted rule loop has gates that prevent context-less emissions.

  Closes #1579.

## 1.14.13

## 1.14.12

## 1.14.11

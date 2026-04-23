# @totem/pack-agent-security

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

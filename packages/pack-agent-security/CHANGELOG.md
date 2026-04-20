# @totem/pack-agent-security

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

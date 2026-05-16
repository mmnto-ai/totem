---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli+core): WWND Claim-Discipline Gate infrastructure + Rule 1 — `totem doctor --claim-discipline` (Proposal 279 PR α)

Ships the infrastructure half of [mmnto-ai/totem-strategy#338](https://github.com/mmnto-ai/totem-strategy/pull/338) (Proposal 279 — WWND Claim-Discipline Gate, merged at `670b635a`). Rules 2-5 + calibration land in PR β per the cross-stream two-PR shape decided at [2026-05-16T20:35Z](https://github.com/mmnto-ai/totem-substrate/blob/main/.handoff/totem-claude/processed/2026-05-16T2035Z-strategy-claude.md).

**Three additions to `LedgerEventSchema`:**

- `claim_discipline_finding` joins the activity-event z.enum sibling family. Emitted by `totem doctor --claim-discipline` when a WWND rule fires on a public-surface diff; `ruleId` carries the WWND rule hash and `activity_name` carries the surface (README.md / AGENTS.md / design-tenets.md / docs/wiki).
- `cli_version` — optional string field carrying the `@mmnto/cli` semver that produced the event. Useful for correlating gate behavior with releases. Available to all activity events, not just claim-discipline.
- `addressed_in_pr` — optional boolean recording whether a `claim_discipline_finding` was addressed inside the same PR that introduced it. Computed at merge time by post-merge replay against the PR-body justification heading.

All schema changes are additive — no migration cost for existing manifests or ledgers. Promotion to `z.discriminatedUnion` stays deferred to A.3.c per the existing OQ-1 comment.

**New `@mmnto/totem` error code:** `CLAIM_DISCIPLINE_FAILED` joins `TotemErrorCode`.

**New `totem doctor --claim-discipline` subcommand.** Sibling to `--compliance` (queued for A.3.b). Three modes:

1. **Default** — surfaces all findings via log.warn / log.error; gate passes unless an `error`-severity finding fires.
2. **`--strict`** — promotes `warning`-severity findings to gate failures. The pre-push hook invokes `--claim-discipline --strict` per Proposal 279 Q3.
3. **`TOTEM_GATE_BYPASS_JUSTIFICATION` env var** — non-empty value records the justification on emitted ledger events and passes the gate regardless of finding severity. Standardized cohort-wide convention from Proposal 279 Q3, mirroring `TOTEM_DRIFT_JUSTIFICATION` from [mmnto-ai/totem#1939](https://github.com/mmnto-ai/totem/pull/1939).

**Discovery convention:** WWND rules are recognized by their `lessonHeading` starting with `"WWND Rule "`. Filename-based discovery (`.totem/lessons/wwnd-*.md`) was considered but adds a two-pass walk; heading-prefix lookup is one-pass against the already-loaded rule set.

**In-scope surfaces:** README.md, AGENTS.md, design-tenets.md (literal, existence-gated), plus recursive walk of `docs/wiki/**` for `.md` files. The recursive walk is a ~10-line zero-dep alternative to the glob package; full glob support deferred to PR β when it becomes load-bearing.

**Pre-push hook integration.** Slot 6 in the existing pre-push sequence, after `verify-badges`. Fires only when at least one in-scope surface exists. Bypass: `TOTEM_GATE_BYPASS_JUSTIFICATION="<reason>" git push`.

**Rule 1 (Absolute-promise detection)** lands as a Pipeline 1 lesson with inline regex pattern from Proposal 279 § Scope:

```
\b(?:[Ww]ill\s+(?:stay|remain|always\s+be|never\s+(?:change|move))|
    [Ww]on['']t\s+(?:change|ever)|
    [Gg]uarantees|
    [Pp]romises\s+to)\b
```

Severity: `warning`. Scope: README.md, AGENTS.md, design-tenets.md, docs/wiki/\*\*. Mechanizes Tenet 19 § How to apply item 4 (covenant claims must name structural backing or soften to present-tense intent). Empirical seed corpus: N=4 within 24h on 2026-05-15 (mmnto-ai/totem#1925, #1932, #1933), all caught post-merge by external review.

Compiles via Pipeline 1 (manual regex, zero LLM call) per the A3 hybrid rule-authoring criterion: when the proposal specifies the exact pattern, the rule lands deterministic and the lesson documents the pattern post-hoc.

**Compile Drift Justification.** The Pipeline 1 add for Rule 1 triggered known compile-corpus drift on 130 sibling rule hashes (lesson sources unchanged; only `lessonHash` rotated). This is the corpus-drift class named in [Proposal 278 § Action 4](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/active/278-compile-worker-determinism-interim-policy.md) (mmnto-ai/totem#1938) and Proposal 281 (axis-4, strategy-Claude drafting in parallel). The new compile output is internally consistent: `verify-manifest` passes (482 rules, hashes match). The drift gate is operating as designed — registering the rotation rather than preventing it (prevention requires axis-4 proposalization, deferred). The `.coderabbit.yaml` exclusion for `.totem/compiled-rules.json` landed in the first commit so bot review focuses on the meaningful change surface.

**Empirical bonus** from smoke-testing the subcommand: it found 1 pre-existing `"guarantees"` in `docs/wiki/governing-ai-agents.md:58`. The gate is already doing useful work. Addressing or accepting the finding is out of scope for PR α; surfacing it is the load-bearing demonstration.

**Tests:** 22 new tests (6 schema, 13 subcommand, 4 hook content); full suite 2192/2192 passing.

**Out of scope (PR β):** Rule 2 (marketing-absolutes — direct + retro-lesson), Rules 3-5 (missing-Goal-prefix, falsifying-metric on ADRs, covenant-without-backing — all lesson→compile per the hybrid criterion), four-week calibration window start, false-positive shavings against the empirical N=5 corpus, ast/ast-grep engine dispatch in the scanner.

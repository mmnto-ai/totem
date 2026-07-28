# @mmnto/pack-agent-workflow

Agent-workflow governance rules for Totem — the Ask 1 micro-pack v1.

Eight governed concepts, **nine compiled entries**, each with adversarial controls at three layers. Identity is agent-workflow-governance, stack-portable by construction. Follows the `@mmnto/pack-agent-security` shape.

Design record: `.totem/specs/ask1-micro-pack.md` (operator design ruling 2026-07-23; pre-build cohort panel and tier rulings 2026-07-24).

## Rules

| #   | Heading                                                                  | Engine   | Target                | Severity |
| --- | ------------------------------------------------------------------------ | -------- | --------------------- | -------- |
| 1   | GitHub auto-close keyword adjacent to an issue reference                 | regex    | markdown              | warning  |
| 2   | Empty catch block silently swallows a failure                            | ast-grep | TS / JS               | error    |
| 3   | Declared CI gate masked with `\|\| true` in a workflow step              | regex    | workflow YAML         | error    |
| 4   | Inlined credential in an agent configuration surface                     | regex    | agent config          | error    |
| 5   | Competing agent-instruction authority claim without an AGENTS.md pointer | regex    | CLAUDE.md / GEMINI.md | warning  |
| 6   | Committed universal agent permission bypass                              | regex    | settings JSON         | warning  |
| 7   | Governance directive in a governed file without a provenance reference   | regex    | `.totem/**` markdown  | warning  |
| 8   | New dependency introduced without disclosure                             | regex    | package.json          | warning  |
| 9   | Optional dependency declared without a fail-loud consumer check          | regex    | package.json          | warning  |

Rules 2 and 3 are the two halves of one governed concept (the fail-open-gate family). They ship as separate entries with separate hashes, headings and messages because they cannot share an `engine` field — see below. A developer who hits one must not receive remediation for the other.

## Engine constraint (verified at source, load-bearing)

ast-grep's built-in extension registry is `.ts` / `.tsx` / `.jsx` / `.js` / `.mjs` / `.cjs` **only** (`packages/core/src/ast-classifier.ts`). Other languages require `registerLang(ext, lang, wasmLoader)` during boot before the registry seals (ADR-097 § 5 Q5) — that is a runtime pack with a boot callback, which this pack's scope excludes ("static data + tests").

**Therefore:** every rule targeting markdown, workflow YAML, or JSON ships `engine: "regex"`. Only rule 2 uses ast-grep.

This is not a stylistic preference. `resolveAstGrepLangs` falls back to `Lang.Tsx` when no positive glob carries a registered extension, so an ast-grep rule globbed at `**/*.md` does **not** fail loud — it silently parses markdown as TSX and never fires correctly. `rules.test.ts` asserts the constraint structurally.

## Severity: advisory collapses to warning

`CompiledRuleSchema` pins `severity` to `error | warning`. The explicit `ruleClass: 'advisory'` marker exists but may only be present alongside a `legitimacy` provenance stamp — a hand-authored pack rule carrying `ruleClass` without `legitimacy` is rejected as a forged hard stamp. So the operator-ruled "advisory tier" for rule 6 is encoded as `severity: "warning"`, which is its operational meaning (printed, non-blocking).

Consequence worth stating: **advisory and warn are indistinguishable in enforcement here.** The operator's original three-tier ruling collapses to two enforcement tiers in v1; advisory survives only as a documented convention over `warning`, not a runtime distinction.

`category` is likewise a fixed four-value enum with no `agent-workflow` member; each rule takes the closest existing category and pack identity lives in the package name.

## Why `.totemignore` here is not the security pack's

`@mmnto/pack-agent-security` excludes `scripts/` and `.github/**` because spawning child processes there is legitimate. **This pack must not copy that.** Rule 3 targets `continue-on-error` / `|| true` masking in workflow YAML, which lives _in_ `.github/workflows/`. Excluding `.github/**` would make that rule dead on arrival — the mmnto-ai/totem#2453 dead-glob class, created at birth. `scripts/` is likewise not excluded: a fail-open gate in a build script is exactly the defect rule 3 targets.

## Control contract — three layers

1. **Layer 1, synthetic.** Every rule carries a `badExample` it must fire on and a `goodExample` it must stay silent on. The good examples are adversarial near-misses, not clean code.
2. **Layer 2, in-situ.** `test/fixtures/wind-tunnel/{bad,good}/` holds realistic files at their logical paths. Each rule must fire on its designated bad site and stay silent on **every** good site its globs admit — not merely its own counterpart.
3. **Layer 3, glob coverage, both sides.** Every positive glob must match at least one wind-tunnel path, **and** every negative glob must exclude a named path that otherwise matches the positives. A dead negative glob silently broadens enforcement, so positive-only coverage is insufficient.

The wind tunnel's on-disk paths deliberately do **not** match the rule globs (they are nested under `test/fixtures/wind-tunnel/<bucket>/`), so the specimens cannot self-fire during a real repo lint. The tests supply the logical path explicitly.

When `mmnto-ai/totem-fixture-ts` is provisioned, this directory is pushed to seed it, preserving parity.

### The layers caught real defects during authoring

Layer 3 rejected five dead globs in the first draft of this pack, before any of it shipped:

- `!**/*.test.*` on rule 4 and `!**/settings.local.json` on rule 6 — dead **negatives**: every positive glob on those rules is an exact filename, so no path could match a positive and the negative together.
- `packages/**/*.js`, `.github/workflows/*.yaml`, and the per-vendor `.gemini` / `GEMINI.md` surfaces — dead **positives** with no specimen to fire on.

## Known limitation, asserted rather than omitted

Rule 1 is a line-oriented regex with no fenced-code-block awareness: it fires on a bare `Closes #N` inside a fenced block. `rules.test.ts` asserts this behaviour so it cannot silently regress into a claim of fence-safety. It is the reason the rule ships warn-tier — it is an adversarial near-miss the rule cannot survive.

## Freeze interaction

The standing `rule-compilation` freeze (since 2026-05-17) covers the **legacy lesson→rule compile path** (`totem lesson compile`). The rules here are hand-authored, pack-local artifacts: no legacy compiler invocation, no repo `.totem/compiled-rules.json` mutation, no compile-manifest touch. Freeze-adjacent, outside the frozen path.

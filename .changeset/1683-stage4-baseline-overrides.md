---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-091 Stage 4 verification baseline overrides (`mmnto-ai/totem#1683`). Bundles three substrate fixes that all touch `packages/core/src/stage4-verifier.ts` overlapping surfaces:

**`mmnto-ai/totem#1683` — T2 baseline overrides.** Adds the `review.stage4Baseline` config field (`{ extend: string[], exclude: string[] }`) and `# stage4-baseline: <glob>` `.totemignore` directives. The default test/fixture exclusions ship as `DEFAULT_BASELINE_GLOBS` (unchanged); consumers `extend` to add globs and `exclude` to remove default entries (e.g., a project that legitimately treats `tests/` as production source). Naming-discipline guard per the GCA finding logged in ADR-091 Deferred Decisions: the schema explicitly rejects an `allowlist` key with a pointer to `mmnto-ai/totem#1683` so a future regression surfaces at config-parse time, not in silent passthrough.

**Public API additions (exported from `@mmnto/totem`):**

- `resolveStage4Baseline(input: ResolveStage4BaselineInput): Stage4Baseline` — pure resolver. Composition order: `defaults ∪ ignoreDirectives ∪ configExtend ∖ configExclude`. Set-difference uses byte-equal glob comparison (so `exclude: ['**/tests/**']` removes that exact default entry). Filesystem access happens at the CLI integration boundary, not in the resolver.
- `parseStage4BaselineDirectives(content: string): string[]` — pure parser for `# stage4-baseline: <glob>` lines. Regex: `/^#\s*stage4-baseline:\s*(.+?)\s*$/`. Skips empty/whitespace directive bodies silently.
- `Stage4Baseline` interface extended with provenance fields (`extendedFromIgnoreFile`, `extendedFromConfig`, `excludedFromConfig`) for `totem doctor` (T4 / `mmnto-ai/totem#1685`) UX surfaces. The verifier itself only reads `excludeFileGlobs`.
- `STAGE4_MANIFEST_EXCLUSIONS: readonly string[]` — see below.
- `getDefaultBaseline()` is now a backward-compat shorthand for `resolveStage4Baseline({})`. Behavior unchanged.

**`mmnto-ai/totem#1758` — matchesGlob → fileMatchesGlobs consolidation.** The Stage 4 verifier's local regex-conversion glob matcher had a substring hole (`**/tests/**` matched `src/contests/foo.ts` because the regex `.*tests/.*` doesn't anchor on segment boundaries). Consolidated onto `fileMatchesGlobs` from `rule-engine.ts` (now exported via the `@mmnto/totem` barrel + the existing `compiler.ts` re-export). The pattern-specific matcher anchors on segment boundaries by construction.

The consolidation surfaced a separate latent bug in the rule-engine matcher: `**/dir/**` patterns recursed by stripping `**/` and then required the rest to match at path-root, so `**/__tests__/**` failed on `packages/cli/src/__tests__/foo.ts`. Fixed by walking every "/"-aligned tail of the path during the `**/` recursion. Three new regression tests on the rule-engine matcher.

**`mmnto-ai/totem#1765` — manifest self-match exclusion.** The Stage 4 verifier intentionally strips `fileGlobs` so the rule fires on every file (in-scope AND baseline), then partitions afterward. Side effect: regex rules with a `badExample` field self-matched against their own entry in `.totem/compiled-rules.json`, routing every such rule to `outcome: 'out-of-scope'` regardless of real codebase risk. Demonstrated cleanly by the `mmnto-ai/totem#1761` AC #1 probe on LC's `init_resource` rule (3 legitimate in-scope hits, but the self-match short-circuited classification).

Fix: `STAGE4_MANIFEST_EXCLUSIONS = ['.totem/compiled-rules.json']` exported constant. The CLI integration site filters this from `git ls-files` output before passing to `verifyAgainstCodebase`. The verifier itself stays a pure function whose contract is "verify the file set you're handed" — tests that pass synthetic file maps don't need the exclusion. `.totem/lessons*.md` carry the same self-match risk in principle but weren't surfaced by the AC #1 probe; adding them is a separate decision.

**Schema deltas:**

- `ReviewConfigSchema` (in `@mmnto/totem`) gains `stage4Baseline: Stage4BaselineConfigSchema.optional()`. Backward compatible: omitted field returns `undefined`, empty `{}` returns `{ extend: [], exclude: [] }`.
- `Stage4BaselineConfigSchema` exported as a sibling of `ReviewConfigSchema`. Z-validates `extend` and `exclude` as `z.array(z.string()).default([])`. Rejects `allowlist` key via `superRefine` with an explicit error message.
- `Stage4Baseline` (existing TS interface) gains three readonly provenance fields (above). Pre-existing constructions with only `excludeFileGlobs` need to migrate to `resolveStage4Baseline({...})` — done in the verifier's own test file as part of this PR.

**CLI wiring:**

`compileCommand` reads `.totemignore` once per compile run, parses directives, and composes the baseline via `resolveStage4Baseline(...)` with overrides from `config.review.stage4Baseline`. The cached baseline is reused across all rules in the batch. ENOENT on `.totemignore` is graceful (treated as no directives); other read errors propagate fail-loud per Tenet 4.

**Bot-review tail:** Sonnet pre-push catches and CR/GCA findings will be addressed in PR amendment rounds. The held `postmerge/1743-1747-1745-1749` bundle was deferred from this PR (Q4 deviation from the approved design doc) — the diff turned out to be 41 lesson files + 336 lines of compiled-rules.json + 182 lines of auto-mirror docs, not "metadata-only" — adding it would expand the bot-review surface beyond the substrate scope. Will ride a future feature PR.

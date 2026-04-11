---
name: postmerge
description: Post-merge workflow — extract lessons and compile rules (manual sequence, wrap is retired)
---

`totem wrap` is retired pending mmnto-ai/totem#1361 (it silently
overwrites hand-crafted committed docs via the `totem docs` step).
Run the post-merge steps directly instead.

After merging PRs, run the following sequence. Replace `$ARGUMENTS`
with the merged PR numbers (space-separated, e.g. `1345 1347 1348`).

1. Extract lessons from the merged PR(s):
   `pnpm exec totem lesson extract $ARGUMENTS --yes`

2. Sync the semantic index (usually already handled by the post-merge
   git hook, but running it explicitly is cheap and safe):
   `pnpm exec totem sync`

3. Compile new rules locally and export to AI tool configs. Do NOT
   pass `--cloud`; the cloud worker is still Gemini-only per
   mmnto-ai/totem#1221. Local compile routes to Sonnet 4.6:
   `pnpm exec totem lesson compile --export`

4. Review the newly compiled rules. Step 3's output prints a count
   like `N/M (100%) ... X compiled, Y skipped, Z failed`. For each
   of the X newly compiled rules, inspect them in
   `.totem/compiled-rules.json` and verify:
   - The `astGrepPattern` or `pattern` is not over-broad (does it
     fire on legitimate code the rule is not trying to flag?)
   - The pattern does not reference hallucinated package names, type
     names, or file paths that do not exist in the repo
   - The `lessonHeading` accurately describes the rule's behavior

   For any rule that fails these checks, mutate
   `.totem/compiled-rules.json` to add `status: 'archived'` and a
   detailed `archivedReason` explaining the specific failure mode.
   The mmnto-ai/totem#1345 archive filter in `loadCompiledRules`
   silences archived rules at lint time while preserving them in the
   ledger for future compile-worker prompt regression analysis. See
   `scripts/archive-bad-postmerge-rules.cjs` (committed on
   mmnto-ai/totem#1366) for the canonical mutation script shape.
   Match target rules by `lessonHash`, not `lessonHeading` (headings
   are auto-truncated to 60 chars and are not guaranteed unique).

   **Do NOT** use `git checkout HEAD -- .totem/compiled-rules.json`
   to revert the entire rules file. Reverting rules while keeping
   the new lessons on disk creates a manifest inconsistency
   (manifest.input_hash reflects the new lessons, output_hash
   reflects the reverted rules, verify-manifest fails on push). This
   is the symmetric counterpart of the mmnto-ai/totem#1337 bug.
   Archive-in-place is the intended curation surface; reverting is
   not.

   Empirical baseline: approximately 2 of every 6 auto-compiled
   rules are bad (1.14.1 postmerge), and the 2026-04-11 PM postmerge
   hit 4 of 5. The compile-worker prompt rewrite conversation lives
   under Strategy #73 and Strategy #62. Every archivedReason is
   feedback that informs that rewrite.

5. Refresh the manifest and exports. After any mutation to
   `compiled-rules.json`, re-run step 3's compile command. It will
   detect the rules file drift via mmnto-ai/totem#1348's no-op
   refresh path, update `compile-manifest.json` hashes, and
   regenerate the copilot and junie exports so they filter the
   newly archived rules out of the exported markdown:
   `pnpm exec totem lesson compile --export`

6. Format everything compile touched:
   `pnpm run format`

7. Stage only the artifacts we keep: new lessons, the mutated rules
   file, the refreshed manifest, the regenerated exports, and any
   curation scripts preserved for institutional memory. Do NOT stage
   `docs/active_work.md`, `docs/roadmap.md`, or
   `docs/architecture.md` unless you hand-edited them deliberately
   (those are `totem docs` targets and a postmerge run should not
   rewrite them):
   `git add .totem/lessons/ .totem/compiled-rules.json .totem/compile-manifest.json .github/copilot-instructions.md .junie/skills/totem-rules/rules.md`

8. Commit:
   `git commit -m "chore: totem postmerge lessons for $ARGUMENTS"`

9. Report: how many lessons extracted, how many rules compiled, how
   many were archived inline with reasons, and whether any new
   tickets were filed for rules that need source-lesson refinement
   before they can be re-compiled cleanly.

The retirement error from `totem wrap` produces this same workaround
text at runtime, so if you forget the sequence, just run
`pnpm exec totem wrap <prs>` and copy the hint.

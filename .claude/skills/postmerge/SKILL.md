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

4. Revert `compiled-rules.json` to the curated set. Compile will
   produce new rules from the extracted lessons, but the curated set
   in main is the source of truth. The new rules should be reviewed
   and cherry-picked by hand rather than auto-merged (empirically
   4/6 auto-compiled rules from the 1.14.1 postmerge were bad, and
   mmnto-ai/totem#1349 now catches the syntactic-invalid cases but
   not the over-broad ones):
   `git checkout HEAD -- .totem/compiled-rules.json`

5. Format everything wrap might have touched:
   `pnpm run format`

6. Stage only the artifacts we keep (lessons, exports, docs if they
   were intentionally updated — NOT `docs/active_work.md`,
   `docs/roadmap.md`, or `docs/architecture.md` unless you hand-edited
   them deliberately):
   `git add .totem/lessons/ .github/copilot-instructions.md .junie/skills/totem-rules/rules.md`

7. Commit:
   `git commit -m "chore: totem postmerge lessons for $ARGUMENTS"`

8. Report: how many lessons extracted, which rules compiled and were
   reverted, whether any over-broad rules warrant follow-up tickets.

The retirement error from `totem wrap` produces this same workaround
text at runtime, so if you forget the sequence, just run
`pnpm exec totem wrap <prs>` and copy the hint.

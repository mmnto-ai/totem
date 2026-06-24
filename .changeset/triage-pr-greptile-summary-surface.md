---
'@mmnto/cli': patch
---

fix(triage-pr): surface review-bot summary issue-comments + never under-report "Nothing to triage"

`totem triage-pr` (and the shared bot-review extractor) now fetch the PR
issue-comment surface via `gh api` — which preserves the `[bot]` login suffix
and `user.type` that `gh pr view` strips — so a review bot's standing summary
comment (where greptile posts its "Comments Outside Diff" findings, edited in
place across review rounds) is recognized as bot material instead of being
silently dropped.

The empty-state guard no longer prints a bare "Nothing to triage" when comments
were fetched: when raw comments exist but none are bot-authored it reports the
per-surface counts, and a bot summary being present (even if it parsed no
discrete findings) always keeps the PR in triage. Adds a provisional greptile
summary parser, modeled on the CodeRabbit outside-diff parser, to be refined
against a captured live sample (mmnto-ai/totem#2192).

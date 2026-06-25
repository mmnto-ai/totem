---
'@mmnto/cli': patch
---

fix(triage-pr): surface greptile's Comments-Outside-Diff + confidence, and never under-report "Nothing to triage"

`totem triage-pr` (and the shared bot-review extractor) now fetch the PR
issue-comment surface via `gh api` — which preserves the `[bot]` login suffix
and `user.type` that `gh pr view` strips — so a review bot's standing summary
comment is recognized as bot material instead of silently dropped.

Greptile's out-of-diff findings are extracted from its summary by the canonical
`<!-- greptile_other_comments_section -->` marker (mmnto-ai/totem-strategy#690),
not a sampled `<details>` shape: greptile edits its summary in place, so the
findings are only present mid-review and the marker is the reliable anchor. The
findings render via the existing bot-agnostic triage table. Greptile's documented
Confidence Score (`N/5`) is surfaced as a triage context signal.

The empty-state guard no longer prints a bare "Nothing to triage" when comments
were fetched: when raw comments exist but none are bot-authored it reports the
per-surface counts, and a bot summary being present (even if it parsed no
discrete findings) always keeps the PR in triage. This makes the tool the
mechanical enforcement of the "read every surface, in full" review-reply
discipline (mmnto-ai/totem#2192).

---
'@mmnto/cli': patch
---

`totem triage-pr` / `review-reply` no longer miss CodeRabbit review-body findings (mmnto-ai/totem#2414, the strategy#828 fetch-completeness class — three live specimens in two days). CodeRabbit renders the whole "Review details" region as a markdown blockquote, so every line's `> ` prefix broke the section regexes — outside-diff sections were present but parsed as absent, and the tool's confident "N findings" output actively suppressed the manual full-body read it replaced. Section parsing now normalizes blockquote prefixes first; the "Additional comments" section gets a parser for ACTIONABLE body-only entries (severity-tagged finding templates only — verification notes and LGTMs never surface); and body findings carry per-file provenance (`path (outside-diff)` / `path (body-only)`) parsed from the section's nested per-file blocks instead of an anonymous `(review body)`, with the body-only severity taken from CodeRabbit's own tag.

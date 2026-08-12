---
'@mmnto/cli': minor
---

feat(triage): normalize `github-code-quality[bot]` as a review surface (mmnto-ai/totem#2626). `triage-pr` and the shared bot-review parser now recognize ghcq by its bot-login shape (the greptile precedent — a human account containing the phrase is not misclassified), so its inline findings ride typed through triage, dedup, and disposition accounting instead of falling to `unknown`. Severity is deliberately `info`-only: the observed corpus (mmnto-ai/liquid-city#980, the first sighting) carries no severity vocabulary, and per the issue's derive-don't-guess rule none is invented. The `review-reply` skill (all distributed copies) records the surface note: ghcq has no @-listener — never tag it; dispositions are audit-trail-only.

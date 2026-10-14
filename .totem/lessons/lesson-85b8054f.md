## Lesson — A lane's missing-file finding is checked against its filter

**Tags:** review-lane, pre-push, payload-filter, phantom-finding, bot-review, trap, s6

**Applies-to:** infrastructure

A review lane's claim that a file lacks something is checked against the lane's payload filter before it is refuted or fixed: a file the filter drops produces a phantom absence. On the fix push of S6 step 8 (mmnto-ai/totem#3066, head 81c6e05f) the pre-push review fan's Sonnet lane returned one CRITICAL, that README.md lacks the new BLOCKING_RULE_SET marker. README.md was in the diff and carried the marker; the lane's review payload filters README.md by its ignore pattern, so the lane never saw the file and reported its absence as the file's defect. The finding was refuted at source in the disposition and CodeRabbit confirmed the marker is present. Rule: for any bot or lane finding of the form "X is missing from file F", first read F in the pushed range, then read the lane's include and ignore patterns; when F is filtered, the finding is a disclosure about the lane's reach, recorded as such, and not a fix. A lane whose payload filter hides a changed file cannot grade that file, and the covariate line should say so rather than carry the CRITICAL as a judgment.

**Source:** mcp (added at 2026-10-14T17:11:14.315Z)

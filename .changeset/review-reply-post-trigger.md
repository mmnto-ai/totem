---
'@mmnto/cli': patch
---

review-reply skill: the distributed text now says what a seat does AFTER a review trigger, in a section before Phase 1 — confirm each invoked bot's review against the review object for the head sha (a fenced, paginated `gh api` read lists every review with the sha it was submitted against) or the bot's summary comment matched by the `Last reviewed commit` sha its body names, never a green commit status on the head (CodeRabbit's status settles green either way; Greptile's check run does mark its sha; GCA posts neither); a chat reply or silence with no review to confirm is not a pass, so the pass is a standalone re-trigger posted by the operator, that bot's first pass rather than a re-invoke; before merging on the other reviewers, wait one acknowledgement window (about 12 minutes from the trigger) or merge and record the late acknowledgement as a line on the PR thread (mmnto-ai/totem#2890).

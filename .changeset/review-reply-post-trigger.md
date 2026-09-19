---
'@mmnto/cli': patch
---

review-reply skill: the distributed text now says what a seat does AFTER a review trigger — confirm each invoked bot's review against the review object or the bot's summary comment for the head sha, never the head's green status; a chat reply or silence with no review to confirm is not a pass, so the pass is a standalone re-trigger on the operator's word; before merging on the other reviewers, wait one acknowledgement window (about 12 minutes) or merge and record the late acknowledgement as a line on the PR thread (mmnto-ai/totem#2890).

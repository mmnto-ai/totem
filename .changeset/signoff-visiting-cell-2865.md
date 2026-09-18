---
'@mmnto/cli': patch
---

The distributed `signoff` skill's Visiting-case sentence now states the rule the paragraph needs — you are visiting when your own agent-id does not appear in your row, whether the cell for your vendor reads `_(not seated)_` or an orphan-stream value or the table has no column for your vendor — so the branch is live for every vendor's session, and its example (`strategy-claude` visiting `totem-status`) satisfies its own gate. It used to test the Claude column for a value no row carries in that column, so half the branch matched nothing (mmnto-ai/totem#2865). Its description of the core map it twins is brought current: the map now seats the four Kimi lanes (mmnto-ai/totem#2875) and the table-to-map sync test holds the two as an equality. Re-stamped by `totem init` on the next consumer sync. (The packages share one fixed changeset group, so every `@mmnto/*` package takes the same bump.)

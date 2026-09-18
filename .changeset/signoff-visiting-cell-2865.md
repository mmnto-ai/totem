---
'@mmnto/cli': patch
---

The distributed `signoff` skill's Visiting-case sentence now keys on the cell for the reader's own vendor in its row (`_(not seated)_` or `_(orphan stream — no native agent)_`), so the branch is live for every vendor's session; it used to name a Claude-column cell value that no row carries, so half the branch matched nothing (mmnto-ai/totem#2865). Its description of the core map it twins is brought current: the map now seats the four Kimi lanes (mmnto-ai/totem#2875) and the table-to-map sync test holds the two as an equality. Re-stamped by `totem init` on the next consumer sync. (The packages share one fixed changeset group, so every `@mmnto/*` package takes the same patch bump.)

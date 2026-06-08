---
'@mmnto/cli': patch
---

fix(review-learn): skip declined bot findings from lesson extraction

`totem review-learn` now recognizes the canonical decline vocabulary — `decline`/`declined` and the `decline-*` classes (doctrine bot-protocols.md §8.1) — in inline review replies, so a soft-decline ("addressed — declined, it's by design") is no longer misread as resolved and laundered into a lesson. Declined findings carry an explicit `disposition` and are surfaced with an auditable breadcrumb instead of a silent skip (the reference for mmnto-ai/totem#2038 reason-code backfill). Closes mmnto-ai/totem#2124 (Surface A; the round-comment-table surface defers to the mmnto-ai/totem-strategy#474 disposition-ledger).

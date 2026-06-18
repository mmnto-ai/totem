---
'@mmnto/cli': patch
---

Wind-tunnel corpus enumeration now walks lc history in **ancestry (topological) order**, not commit-date — `totem spine windtunnel` enumerates merged PRs via `git log --topo-order` (mmnto-ai/totem#2189 item 2 follow-up).

A `bounded` selectionRule window takes "the N most recent qualifying PRs" off the front of the enumerated list, so "most recent" must mean N-most-recent-by-ancestry, never by timestamp (ADR-110 §6 ancestry-not-timestamp; strategy-claude 2026-06-18 ruling). Commit dates are non-monotonic and rewritable (rebases, clock skew), which would make a bounded window's membership non-deterministic. The reachable PR **set** is unchanged either way (so the certifying `window: all` path is unaffected); this hardens the `bounded` path against a future non-linear merge or date-skewed history.

## Lesson — totem mail's human listing carries a read: absolute path

**Tags:** mail, ecl, cli, blind-round, trap

**Applies-to:** infrastructure, boundary

`totem mail`'s human listing carries a `read: <absolute path>` line under every LISTED unread item since the mmnto-ai/totem#2922 merge (caa425db, the cut after @mmnto/cli 2.9.2; the mmnto-ai/totem#2919 datum): read a dispatch at that path and pass the same string to `totem mail mark`; never list a sender's outbox to find a file — one sender's outbox holds that sender's dispatches to EVERY seat, and during a BLIND round a listing of it is a disclosure (lc-kimi, 2026-09-21). The line is the same `filePath` the `--json` item emits, so lesson-296c72de's `--json` route stays valid. It names the OUTBOX OWNER (filesystem truth, the seat directory the poll opened) where the item line's `from` is the forgeable header — a `from:` that disagrees with the read line's seat directory is a forged sender. Withheld directed items on an identity-gated poll and the `source: none` arm list nothing, path included; the empty-inbox verdict lines are unchanged. The path renders for every listed item regardless of whose mail the poll serves (`--as <other-seat>`, `--all-seats`): the listing's membership is the exposure boundary ecl-discipline § 4.7 bounds by conduct, not the path, which is derivable from the `Workspace:` line and the item line in the default layout.

**Source:** mcp (added at 2026-09-21T19:58:55.253Z)

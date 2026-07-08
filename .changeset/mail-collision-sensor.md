---
'@mmnto/cli': minor
---

`totem mail` gains a cross-sender basename-collision sensor (mmnto-ai/totem#2311; read-side half of mmnto-ai/totem-strategy#827).

**What it detects.** ECL dispatch filenames don't encode the sender and `processed/` dedupe is basename-only — so when two distinct seats converge on one addressed-inbound basename in a single poll, a single mark would silently shadow BOTH dispatches (the second never surfaces as unread). `pollMail` now emits one structured warning per colliding basename, naming every `repo/agent` sender path, into the existing `warnings` array.

**Composition, not plumbing.** Because `totem ecl-gc --compact` arms its A2.2 completeness gate on `poll.warnings.length === 0` (mmnto-ai/totem#2309) and its discovery poll reads through marks (`includeProcessed`, A2.1), a live collision automatically blocks mark-compaction during exactly the coexistence window in which compaction could strand a dispatch — zero new gate surface.

**Sensor, not actuator (Tenet 13).** Warn-only: both dispatches still surface as unread mail; nothing is renamed, moved, or deleted. Sender identity keys on the outbox-owner seat (filesystem truth under single-writer discipline), never the forgeable `from:` header — one seat's broadcast fan-out copies across repos never fire it. No `MailPollResult` shape change; JSON consumers see the new message in the existing `warnings` field. Encoding `<sender>` into the filename convention remains the escalation path on mmnto-ai/totem-strategy#827 if this sensor ever fires on a real drop.

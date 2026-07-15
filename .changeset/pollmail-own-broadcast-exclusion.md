---
'@mmnto/cli': patch
---

fix(mail): a seat's own outbound broadcast no longer surfaces as its own unread (mmnto-ai/totem#2364).

`pollMail` filtered by recipient only, so a seat that broadcast to the cohort read "1 unread" from its own outbox forever unless it hand-backfilled a `processed/_broadcast/` mark (live exhibit: a strategy-seat round-reply broadcast red in every one of that seat's orientations for 8 days). The unread scan now excludes a dispatch when its source outbox belongs to a SELF agent AND `to: broadcast` — keyed on the outbox-owner directory (single-writer filesystem truth, same doctrine as the basename-collision sensor), never the forgeable `from:` header.

Scope guards: the `includeProcessed` discovery view (ecl-gc compaction, ADR-106 § A2.1) keeps the RAW addressed-inbound set — excluding own-broadcasts there would read existing self-marks as stale and collect marks that must be retained. Directed self-mail (`to:` a SELF agent from an own outbox) stays surfaced; broadcasts are the observed noise class.

Consumer-impact: `totem mail` unread output + every `pollMail()` consumer (SessionStart hooks, MCP audits) stop counting the polling seat's own broadcasts as unread. Under a dirs-derived multi-seat union view (no `TOTEM_SELF_AGENT` scoping), broadcasts from any unioned seat are treated as "own" — consistent with that view's existing self-set semantics. No schema or flag changes.

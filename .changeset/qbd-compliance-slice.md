---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

Query-before-derive compliance — one falsifying number wired end-to-end (mmnto-ai/totem#2510). Of the derive-class actions in an agent session (`totem spec` synthesis, `totem orient` derivation, `totem review` grounding), what fraction was preceded by a corpus query correlated to that action?

The Trap Ledger gains two event types — `corpus_query` and `derive_action` — joined by a new `qbd_correlation_id` field, kept deliberately separate from ADR-014's `correlation_id` trace ID because this slice is explicitly not chartered to build that telemetry stack. The correlation ID is **self-dating**: it encodes the instant it was minted, and `LedgerEventSchema` cross-checks that instant against the timestamp of the row carrying it. A query row whose ID was not minted at its own write instant, or a derive row citing an ID minted after the derive or older than the correlation window, fails to parse — so "IDs are minted at event-write time" is a schema constraint rather than a convention, and a backfilled ID is a schema violation rather than a data point.

Query events are emitted from the shared core seam behind both query surfaces: the `totem search` CLI path and the MCP `search_knowledge` tool. Derive events are emitted from `spec`, `orient`, and `review`. The correlation window reuses the ADR-029 § 2 two-hour session window rather than inventing a constant, and session identity reuses the existing `.session-id` primitive with the same rolling-window fallback for hookless runs.

`totem doctor --compliance` renders the number, its trend, and the pre-registered threshold and window verbatim: compliance ≥ 0.50 over the first 20 instrumented sessions carrying ≥1 derive-class event, regardless of query count. The verdict stays `PENDING` until that window fills — calling it early would be as much a post-hoc reinterpretation as moving the threshold. The denominator is every derive-class event in those sessions, including sessions that fired zero queries, closing denominator gaming at both the ratio and the window level.

Sensor, not actuator (Tenet 13): nothing gates on this number, no exit code changes, and an instrumentation write failure never breaks the instrumented command — it surfaces as a named warning instead. Degraded reads announce themselves: because a schema-invalid row is skipped by the generic ledger reader, the compliance scanner parses the NDJSON itself and counts every rejected line by class, so a torn or tampered ledger renders under an explicit `DEGRADED` / `UNVERIFIED` envelope instead of as a confident 100% or 0%.

Known limit, stated rather than solved: this senses query-before-derive _adjacency_, not influence. A query fired to satisfy the metric whose results the following derive never reads is indistinguishable here from one that genuinely grounded it.

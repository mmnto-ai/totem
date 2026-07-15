## Lesson — Never accept persisted derived counts, labels, or rollups

**Tags:** schema, derived-fields, anti-tamper, read-boundary, predictable-robustness

**Applies-to:** boundary, aggregator

Never accept persisted derived counts, labels, or rollups on trust; recompute them from the primitive arrays at schema parse/read time and reject any mismatch. (Sweep TOTEM-SWEEP-007, reclassed lesson-tier per strategy curation — not mechanically checkable; anchor: #2179 bot rounds, hardened @ edde219b. Same invariant independently re-derived for verdict artifacts in #2337.)

**Source:** mcp (added at 2026-07-12T03:08:37.890Z)

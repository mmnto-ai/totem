## Lesson — An incremental index must derive deletions

**Tags:** indexing, incremental-sync, reconciliation, orphans, predictable-robustness

**Applies-to:** mutator, infrastructure

An incremental index must derive deletions by reconciling indexed keys against the current target set; a diff window cannot recover deletes, renames, ignore changes, or de-targeting that occurred before its baseline, and purge-only runs must rebuild dependent indexes. (Sweep TOTEM-SWEEP-011; anchor: #2174 orphan chunks, fixed @ 7179daa2.)

**Source:** mcp (added at 2026-07-12T03:09:18.219Z)

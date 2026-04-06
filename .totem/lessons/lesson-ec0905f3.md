## Lesson — Seed unknown buckets when refining metrics

**Tags:** metrics, data-integrity
**Scope:** packages/core/src/rule-metrics.ts

When splitting a single aggregate counter into granular sub-buckets, seed the 'unknown' category with the previous total to maintain historical data continuity.

# Architecture & Metrics

Totem tracks advanced telemetry on rule execution to identify false positives and drive the self-healing loop.

## RuleMetric schema

The telemetry data is stored within the `compiled-rules.json` manifest. The key structure is the `RuleMetric.contextCounts` schema:

```typescript
{
  code: number,
  string: number,
  comment: number,
  regex: number,
  unknown: number
}
```

## Semantic Invariants

- **`triggerCount`**: This is the rolled-up total of all matches across all contexts.
- **`contextCounts.code`**: This is the authoritative violation count. It represents matches that landed in actual executable code, not strings or comments.
- **`unknown` bucket**: This holds historical pre-context-aware telemetry. It is explicitly excluded from the non-code ratio math used by `totem doctor` to determine if a rule is noisy.

## Off-by-one Seeding

When `recordContextHit` is first called for a rule that already had a `triggerCount` before version 1.13.0, the historical hits are seeded into the `unknown` bucket as `triggerCount - 1` (the `1` accounts for the current call). For example, if `triggerCount` is `7` at the first call, `unknown` is seeded to `6`. Historical totals stay consistent and the new context-aware buckets stay accurate from the first call forward.

## Lesson — Exclude unknown buckets from telemetry ratios

**Tags:** telemetry, math, diagnostics
**Scope:** packages/cli/src/commands/compile.ts

When calculating ratios from categorical telemetry (like code vs. non-code), exclude 'unknown' buckets from both the numerator and the denominator. Including 'unknown' in the total denominator artificially dilutes the ratio, leading to false negatives in quality diagnostics.

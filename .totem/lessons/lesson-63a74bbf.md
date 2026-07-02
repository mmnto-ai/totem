## Lesson — Require explicit timezones for ISO instants

**Tags:** iso8601, validation, determinism
**Scope:** packages/core/src/spine/authored-freeze-gates.ts

ISO-8601 strings without 'Z' or an offset can be parsed as local time, leading to non-deterministic temporal comparisons. Always require explicit timezones in validation regex to ensure consistent behavior across different environments.

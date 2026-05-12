## Lesson — Memoize regex instances in evaluators

**Tags:** performance, regex
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Cache compiled `RegExp` objects instead of re-instantiating them on every invocation in hot paths to significantly reduce CPU overhead and improve evaluation throughput.

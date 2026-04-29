## Lesson — Warn on large diffs before LLM

**Tags:** llm, dx, performance
**Scope:** packages/cli/src/index.ts

Surface diff truncation warnings at the resolution layer before LLM invocation to prevent degraded reviews and avoid unnecessary token costs.

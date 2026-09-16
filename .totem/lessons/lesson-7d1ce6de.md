## Lesson — Anchor marker pairing from the end

**Tags:** parsing, regex, robustness
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Pairing markers by matching the first end marker with the closest preceding start marker prevents orphan markers above the span from widening the replacement range.

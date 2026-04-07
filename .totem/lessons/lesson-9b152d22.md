## Lesson — Validate single-backtick wrappers before stripping

**Tags:** regex, parsing, llm
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Unconditionally stripping single backticks can corrupt patterns with internal backticks; use a strict regex to ensure the characters are actually external wrappers.

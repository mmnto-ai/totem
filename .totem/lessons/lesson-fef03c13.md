## Lesson — Always escape hyphens in regex utilities

**Tags:** regex, security
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Regex escaping must include the hyphen to prevent unintended range behavior when the escaped string is interpolated into a character class `[...]`.

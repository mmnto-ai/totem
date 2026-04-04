## Lesson — Use centralized utilities for regex escaping

**Tags:** security, dx
**Scope:** packages/core/src/eslint-adapter.ts

Building regex patterns from dynamic configuration requires using a centralized `escapeRegex` utility. This prevents regex injection vulnerabilities and ensures that characters like `.` or `$` in configuration strings are treated as literals.

## Lesson — Sanitize git-derived text

**Tags:** security, logging, git
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Raw text extracted from git diffs or external badges can contain ANSI escape codes or control characters that enable terminal injection if logged directly.

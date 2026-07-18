## Lesson — Normalize both sides of filename comparisons

**Tags:** fs, refactoring
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When introducing filename sanitization, both the reader and the garbage collector must normalize filenames on both sides of any comparison. Failing to do so causes the compactor to misidentify sanitized marks as inert and prematurely collect them.

## Lesson — Prefer negative filters for compatibility

**Tags:** typescript, architecture, migration
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using negative filters like `!== 'archived'` instead of positive ones like `=== 'active'` ensures that legacy records lacking the new status field remain functional by default.

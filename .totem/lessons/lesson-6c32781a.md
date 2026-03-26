## Lesson — Restrict dynamic import security rules to core and adapter

**Tags:** security, architecture, linting
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Restrict dynamic import security rules to core and adapter packages while exempting CLI command entry points. This eliminates recurring linter noise in command files where dynamic loading is often required for performance or modularity.

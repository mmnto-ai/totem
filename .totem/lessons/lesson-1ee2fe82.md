## Lesson — Thread custom installation hints for unmanaged surfaces

**Tags:** cli, architecture
**Scope:** packages/cli/**/*.ts, !**/*.test.*

When a CLI doctor command detects drift on surfaces not managed by the default initializer, thread a custom `installHint` rather than pointing users to an inert initialization command.

## Lesson — Assert import boundaries in LLM-free tests

**Tags:** testing, architecture
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Use regex-based test assertions to forbid both static and dynamic transitive imports of heavy dependency graphs (like orchestrators) in modules intended to be lightweight.

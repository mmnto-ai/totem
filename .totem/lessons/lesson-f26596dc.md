## Lesson — Do not stamp unreviewed skips as reviewed

**Tags:** security, git-hooks, authorization
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Stamping a content hash as 'reviewed' on deterministic skips (like docs-only changes) can inadvertently authorize unreviewed code to bypass push gates.

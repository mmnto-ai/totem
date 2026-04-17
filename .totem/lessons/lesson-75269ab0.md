## Lesson — Allow null branches for detached HEADs

**Tags:** git, testing, ci
**Scope:** packages/mcp/src/**/*.test.*

Git state extractors must treat the current branch as optional (string or null) to prevent test failures in CI environments that use detached HEAD states.

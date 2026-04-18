## Lesson — Handle detached HEAD states in tests

**Tags:** git, testing, ci
**Scope:** packages/mcp/src/**/*.test.ts

Test fixtures for Git state must allow `currentBranch` to be null to account for detached HEAD states in CI environments. Hardcoding non-null branch strings can cause failures in automated pipelines.

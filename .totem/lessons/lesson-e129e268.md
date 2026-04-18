## Lesson — Allow null branches for detached HEADs

**Tags:** git, ci, testing
**Scope:** packages/mcp/src/**/*.test.ts

Git state mocks and types must allow `currentBranch` to be null to correctly handle detached HEAD states frequently encountered in CI environments.

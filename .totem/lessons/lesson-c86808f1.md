## Lesson — Mock public APIs at package boundaries

**Tags:** testing, vitest, monorepo
**Scope:** packages/cli/src/adapters/*.test.ts

When testing across package boundaries, mock the public API of the imported package rather than its internal dependencies. Vitest may fail to intercept internal imports if the consumer package resolves to a pre-built distribution file.

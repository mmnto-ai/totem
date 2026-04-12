## Lesson — Mock package boundaries for cross-package tests

**Tags:** testing, vitest
**Scope:** packages/**/*.test.*

Vitest mocks of internal dependencies do not intercept imports within pre-built distribution files; mock the public package boundary instead to ensure interceptors bind correctly.

## Lesson — Prefer global mock restoration in Vitest

**Tags:** vitest, testing, typescript
**Scope:** packages/**/*.test.ts

Use `vi.restoreAllMocks()` in `afterEach` instead of assigning `vi.spyOn` results to variables. This avoids TypeScript narrowing issues in strict mode when mocking global objects like `fetch`.

## Lesson — Explicitly configure Vitest hook timeouts

**Tags:** vitest, testing, ci
**Scope:** packages/**/vitest.config.ts

Vitest defaults `hookTimeout` to 10 seconds and does not inherit from `testTimeout`. If setup hooks (like `beforeEach`) spawn slow processes or build fixtures, they will time out on loaded CI runners unless `hookTimeout` is explicitly aligned with the test timeout floor.

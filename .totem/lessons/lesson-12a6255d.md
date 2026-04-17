## Lesson — Restrict fallback to specific error codes

**Tags:** error-handling, architecture
**Scope:** packages/mcp/src/**/*.ts, !**/*.test.*

When implementing fallbacks for optional system components, only swallow specific 'unavailable' errors. Re-throwing unexpected failures prevents masking critical bugs or configuration issues.

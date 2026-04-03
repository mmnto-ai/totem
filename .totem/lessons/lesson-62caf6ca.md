## Lesson — Avoid empty catch blocks using discards

**Tags:** typescript, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Use a discard variable (e.g., catch (_err)) in catch blocks instead of leaving them empty to satisfy 'never empty catch' rules while maintaining intentional silent failure behavior.

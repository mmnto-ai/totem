## Lesson — Differentiate engine unavailability from general errors

**Tags:** error-handling, wasm
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

When catching initialization failures for optional engines, verify the error message contains engine-specific identifiers like 'WASM'. Blindly catching all errors as 'unavailable' can mask unrelated architectural defects.

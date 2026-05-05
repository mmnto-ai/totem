## Lesson — Verify gate ordering in short-circuit tests

**Tags:** testing, architecture
**Scope:** packages/cli/src/commands/**/*.test.ts

Tests for mutex flags should explicitly assert that downstream side-effects, like configuration loading, were never triggered to verify the validation gate's position.

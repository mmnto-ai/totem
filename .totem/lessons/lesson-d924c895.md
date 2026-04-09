## Lesson — Verify caching via full round-trip tests

**Tags:** testing, caching
**Scope:** packages/cli/src/utils.test.ts

Tests should execute actual write-then-read cycles against a temporary directory to catch logic mismatches between the cache writer and reader that local hash reconstruction might miss.

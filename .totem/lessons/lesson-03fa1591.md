## Lesson — Stabilize tests with conditional resolution skips

**Tags:** testing, integration, ci
**Scope:** packages/mcp/src/**/*.test.ts

Integration tests depending on host-resolved paths should use conditional runtime skips to avoid false negatives when the resource is legitimately missing.

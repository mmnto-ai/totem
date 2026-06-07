## Lesson — Warn on missing optional manifest assets

**Tags:** cli, dx, parity
**Scope:** packages/cli/**/*.ts

Diagnostic tools should treat configured but missing assets from optional dependencies as non-blocking warnings to support environments where the dependency was intentionally skipped.

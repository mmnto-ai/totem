## Lesson — Avoid live-repo coupling in tests

**Tags:** testing, git, ci
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Tests using the live repository root are coupled to working-tree size and can flake as the project grows. Use fixture-based repositories for deterministic cross-platform testing and explicit edge-case coverage.

## Lesson — Align exclusion paths with scanner output roots

**Tags:** git, monorepo, paths
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Exclusion paths must be resolved relative to the same root as the scanner output (e.g., `repoRoot` for `git ls-files`). Using `configRoot` or `cwd` in monorepos causes path mismatches and false-positive matches.

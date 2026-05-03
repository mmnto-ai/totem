## Lesson — Ensure monorepo exclusions are root-relative

**Tags:** monorepo, git, path-resolution
**Scope:** packages/cli/**/*.ts

Path exclusions for tools like `git ls-files` fail in monorepo subpackages if they are not relative to the repository root. Defer path computation until the repo root is resolved to ensure consistent behavior across different package depths.

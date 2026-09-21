## Lesson — Assert all documented execution paths

**Tags:** testing, regression, documentation
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When documenting multiple alternative paths (such as workspace vs. installed-package entry points), regression tests must assert all variants. This prevents synchronized templates or documentation from silently drifting or dropping critical consumer paths.

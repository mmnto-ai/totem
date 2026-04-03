## Lesson — Always trim git output whitespace

**Tags:** git, node, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Git command outputs often contain trailing newlines or whitespace that must be trimmed before being used in path resolution or logic. Failure to trim can lead to invalid file paths or incorrect string comparisons that are difficult to debug.

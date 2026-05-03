## Lesson — Use engines for version-tool-immune constraints

**Tags:** npm, changesets, architecture
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

The `engines` field is npm-canonical for constraints and immune to Changesets fixed-group auto-bumps, preventing unintended major version cascades in sibling packages.

## Lesson — Scope dependency checks to importers

**Tags:** pnpm, monorepo, workspace
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Scanning every tracked package.json for dependency declarations can false-block on non-workspace fixtures. Instead, read declarations directly from the lockfile's own 'importers' set to scope the checks accurately.

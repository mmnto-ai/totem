## Lesson — Enforce section-aware lockfile parsing

**Tags:** pnpm, parser
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Lockfile resolution checks must target specific sections like 'packages' or 'snapshots' to prevent metadata blocks (such as peerDependenciesMeta) from falsely satisfying resolution checks and masking dropped packages.

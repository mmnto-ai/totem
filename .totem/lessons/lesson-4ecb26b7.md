## Lesson — Use explicit monorepo test globs

**Tags:** glob, monorepo, security
**Scope:** packages/pack-agent-security/compiled-rules.json

Broad exclusions like `!**/test/**` may fail to exclude nested package test directories in a monorepo. Use explicit patterns like `packages/**/test/**` to ensure security rules don't inadvertently lint consumer test trees.

## Lesson — Explicitly exclude nested monorepo test paths

**Tags:** monorepo, glob, configuration
**Scope:** packages/pack-agent-security/test/**/*.ts

Broad test exclusions like '**/test/**' may fail in complex monorepos; use explicit patterns like 'packages/**/test/**' to ensure rules don't leak into consumer test suites.

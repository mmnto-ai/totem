## Lesson — Compare filesystem paths case-insensitively on Windows

**Tags:** windows, cross-platform, filesystem
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Path comparisons for workspace boundaries or pins must be case-insensitive on Windows while remaining case-sensitive on POSIX. Case mismatches on Windows can cause valid operations to be incorrectly rejected.

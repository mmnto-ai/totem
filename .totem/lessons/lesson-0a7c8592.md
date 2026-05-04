## Lesson — Validate resolved paths as directories

**Tags:** filesystem, security
**Scope:** packages/core/src/**/*.ts

Path resolution must verify that the target is a directory using isDirectory() to prevent logic errors when a file exists at the expected location.

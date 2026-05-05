## Lesson — Trigger manifest staleness on semver-minor drift

**Tags:** versioning, ux
**Scope:** packages/core/src/**/*.ts, !**/*.test.*

Detecting stale manifests based on semver-minor mismatches while tolerating patch drift provides helpful UX nudges without being overly restrictive for users.

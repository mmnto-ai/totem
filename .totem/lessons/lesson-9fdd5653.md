## Lesson — Prioritize incompatibility guards over validation

**Tags:** cli, ux
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Execute mutual incompatibility checks between flags before running individual flag validation. This ensures users see errors about conflicting features rather than misleading downstream constraints or missing value errors.

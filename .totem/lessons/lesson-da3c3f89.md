## Lesson — Keep execution metadata timestamps strictly causal

**Tags:** git, metadata, ci-cd
**Scope:** packages/**/*.ts, !**/*.test.*

Recording future or post-commit timestamps in audit logs can trigger strict gate validation failures. Deriving timestamps from measured launch times plus actual execution duration ensures all metadata remains logically causal.

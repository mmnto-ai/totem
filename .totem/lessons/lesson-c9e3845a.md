## Lesson — Design availability probes to never throw

**Tags:** api-design, error-handling
**Scope:** packages/core/src/**/*.ts, !**/*.test.*

Availability probes should catch all network and status errors to return a simple boolean. This prevents diagnostic tools or fallback chains from crashing due to environmental network issues.

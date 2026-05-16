## Lesson — Discriminate filesystem errors for telemetry

**Tags:** fs, telemetry, error-handling
**Scope:** packages/core/src/session-id.ts

Swallow common environment errors like EPERM or EROFS during telemetry writes to prevent tool breakage while rethrowing unexpected classes to maintain observability.

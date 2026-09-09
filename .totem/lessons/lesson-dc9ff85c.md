## Lesson — Pair label creation with edits

**Tags:** github-api, automation, idempotency
**Scope:** scripts/sync-labels.ps1

Running metadata edits on non-existent GitHub labels causes synchronization failures on fresh repositories. Preceding every edit command with an expected-fail creation command ensures idempotency across all environments.

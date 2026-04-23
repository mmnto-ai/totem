## Lesson — Validate rules before manifest refresh

**Tags:** integrity, manifest
**Scope:** packages/cli/src/commands/compile.ts

Preload and validate the integrity of the target rules file before updating its manifest hash to prevent a manifest refresh from masking existing file corruption.

## Lesson — Require multiple markers for standalone detection

**Tags:** cli, governance
**Scope:** packages/cli/src/utils/governance.ts

Standalone repository detection should require multiple markers (e.g., both proposals and ADR directories) rather than a single folder. Permissive detection leads to incorrect scaffolding paths in complex monorepos.

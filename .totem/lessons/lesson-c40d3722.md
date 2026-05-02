## Lesson — Exclude state files from verifier inputs

**Tags:** architecture, testing
**Scope:** packages/cli/src/commands/first-lint-promote-runner.ts

Explicitly exclude state files from the verifier's input set to prevent circularity or the inclusion of metadata as part of the codebase being analyzed.

## Lesson — Log diff source discriminators for transparency

**Tags:** dx, git, logging
**Scope:** packages/cli/src/git.ts

When using implicit fallback chains for data resolution, log the chosen source to stderr so the operator's mental model matches the actual system state.

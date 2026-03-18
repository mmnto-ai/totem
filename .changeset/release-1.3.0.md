---
'@mmnto/cli': minor
'@mmnto/totem': patch
'@mmnto/mcp': minor
---

Release 1.3.0 — MCP verify_execution, spec inline invariants, baseline Fix guidance.

### Highlights

- **MCP `verify_execution` tool**: AI agents can now mathematically verify their work before declaring a task done. Runs `totem lint` as a child process and returns pass/fail with violation details. Supports `staged_only` flag. Warns about unstaged changes.
- **Spec inline invariant injection**: `totem spec` now outputs granular implementation tasks with Totem lessons injected directly into the steps where they apply. Closes the gap between "planning" and "doing."
- **Baseline Fix suggestions**: 24 of 59 universal baseline lessons updated with explicit "Fix:" guidance. Every lesson now tells developers what TO do, not just what to avoid.

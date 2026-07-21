## Lesson — Distinguish admission from execution failures

**Tags:** cli, diagnostics, ux
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Conflating admission-phase configuration errors with execution-phase failures in user diagnostics misleads operators. Ensure error messages clearly distinguish between lanes that failed to invoke and those that failed during execution.

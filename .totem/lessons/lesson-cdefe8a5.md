## Lesson — Keep CLI installation hints platform agnostic

**Tags:** cli, windows, dx
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Remediation and installation hints should avoid platform-specific shell commands like `cp` to prevent execution failures in Windows environments.

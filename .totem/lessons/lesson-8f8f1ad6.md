## Lesson — Sequence validation gates before override blocks

**Tags:** security, validation, override
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Validation gates for unsettled rounds must execute before override or cache-stamp blocks. This prevents override flags from falsely authorizing actions or minting push permissions on incomplete runs.

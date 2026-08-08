## Lesson — Verify resource absence independently of exit codes

**Tags:** git, filesystem, reliability
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Do not rely on Git exit codes to guarantee clean worktree removal; always perform independent post-removal filesystem checks to ensure no residue remains.

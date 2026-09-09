## Lesson — Scrub ambient Git environment variables

**Tags:** git, testing, subprocess
**Scope:** packages/core/src/sys/git.ts

Ambient Git environment variables like GIT_DIR can leak into spawned subprocesses and corrupt local repository resolution. Scrubbing these variables from the environment before running Git commands ensures deterministic behavior.

## Lesson — System calls in automation scripts often fail silently

**Tags:** node, shell, reliability

System calls in automation scripts often fail silently if the exit status or error property isn't explicitly checked. Always validate `spawnSync` results to prevent the process from proceeding as if a critical command like `git commit` succeeded.

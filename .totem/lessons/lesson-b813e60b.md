## Lesson — Check the process status (e.g., via process.kill(pid, 0))

**Tags:** concurrency, filesystem, nodejs

Check the process status (e.g., via `process.kill(pid, 0)`) before unlinking a stale lock to prevent Time-of-Check to Time-of-Use (TOCTOU) races. This prevents a process from accidentally deleting a valid lock acquired by a peer that just replaced the stale one.

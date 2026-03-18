## Lesson — Using child.kill() on Windows when shell: true is enabled

**Tags:** nodejs, windows, child-process

Using `child.kill()` on Windows when `shell: true` is enabled often fails to clean up child processes, leaving orphaned "zombie" processes. Developers must use `taskkill /pid [pid] /T /F` to ensure the entire process tree is terminated.

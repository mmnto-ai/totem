## Lesson — Using child.kill() on Windows when shell: true is enabled

**Tags:** windows, nodejs, process-management

Using `child.kill()` on Windows when `shell: true` is enabled only terminates the `cmd.exe` wrapper, leaving the actual application as a zombie process. To prevent process leaks during timeouts, use `taskkill /T /F` to ensure the entire process tree is destroyed.

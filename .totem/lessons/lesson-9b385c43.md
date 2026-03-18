## Lesson — Binaries like git may fail to resolve correctly when using

**Tags:** nodejs, windows, security

Binaries like `git` may fail to resolve correctly when using `execFileSync` on Windows unless `shell: true` is explicitly enabled. This ensures the environment correctly locates the executable within the command shell context.

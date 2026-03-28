## Lesson — Incremental validation is only reliable if the current head

**Tags:** git, security, architecture

Incremental validation is only reliable if the current head is a direct descendant of a previously verified commit. This prevents logic gaps and security bypasses when switching between unrelated branches or working with non-linear history.

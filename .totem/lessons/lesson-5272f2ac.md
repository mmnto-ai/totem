## Lesson — The shell option in spawn() calls should be omitted

**Tags:** security, nodejs, subprocess
**Engine:** ast-grep
**Severity:** warning
**Scope:** **/*.ts, **/*.js
**Pattern:** `spawn($CMD, [$$$ARGS], { $$$BEFORE, shell: true, $$$AFTER })`

The shell option in spawn() calls should be omitted when command arguments are already provided as an array. Using structured arguments provides inherent safety, while avoiding the shell reduces the attack surface for command injection.

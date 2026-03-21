## Lesson — Prefer [[ "$VAR" == "pattern"* ]] over piping to grep

**Tags:** bash, shell-scripting, performance

Prefer `[[ "$VAR" == "pattern"* ]]` over piping to `grep` to avoid the performance overhead of spawning a subshell. Utilizing built-in shell constructs makes git hooks faster and more efficient, especially when multiple checks are performed in sequence.

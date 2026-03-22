## Lesson — PID-based process liveness checks (process.kill(pid, 0))

**Tags:** manual
**Engine:** ast-grep
**Severity:** warning
**Scope:** **/*.ts, **/*.js
**Pattern:** `process.kill($PID, 0)`

PID-based process liveness checks (process.kill(pid, 0)) fail across PID namespaces (Docker containers, CI runners). A container's PID 1 will always appear alive from the host. For cross-namespace safety, combine PID checks with stale timestamps — treat locks as dead if both the PID check fails OR the timestamp exceeds a generous threshold. Tags: concurrency, containers, trap

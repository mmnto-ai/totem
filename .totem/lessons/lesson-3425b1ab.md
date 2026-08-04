## Lesson — PID probes lie across container namespaces

**Tags:** lock, containers, process
**Scope:** packages/core/src/lock.ts

PID probes can report false liveness when processes run across different container namespaces. Staleness thresholds based on heartbeats must remain the final authority for lock liveness.

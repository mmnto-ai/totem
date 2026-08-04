## Lesson — Diagnose silent detached child failures

**Tags:** node, process, observability

To diagnose silent failures in detached processes with ignored stdio, write a stamp before spawning and pass the log file descriptor to the child. A stamp without subsequent child output proves the process failed or was reaped.

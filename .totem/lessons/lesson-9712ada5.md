## Lesson — Reject non-positive PIDs and infinite timestamps

**Tags:** node, security, process

Reject non-positive PIDs and infinite timestamps in lockfiles to prevent accidental signaling of process groups via process.kill(0) and broken staleness math.

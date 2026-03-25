## Lesson — Silent failures in 'best-effort' operations like staleness

**Tags:** cli, error-handling

Silent failures in 'best-effort' operations like staleness checks or documentation assembly hinder observability and debugging. Use non-blocking logging instead of empty catch blocks to ensure IO failures are traceable without crashing the primary command execution.

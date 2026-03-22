## Lesson — When inserting blocks into user-managed files, use explicit

**Tags:** architecture, cli, scripts

When inserting blocks into user-managed files, use explicit start and end markers to ensure reliable removal. Without a deterministic end marker, automated cleanup commands must rely on fragile heuristics that risk over-scrubbing or corrupting user-authored content.

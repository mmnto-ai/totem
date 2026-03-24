## Lesson — Eagerly importing heavy modules at the top level of CLI

**Tags:** cli, performance

Eagerly importing heavy modules at the top level of CLI command files increases startup latency; use dynamic import() within handlers to keep help checks fast.

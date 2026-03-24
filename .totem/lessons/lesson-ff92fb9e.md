## Lesson — Eagerly importing heavy modules at the top level of CLI

**Tags:** performance, cli, dx

Eagerly importing heavy modules at the top level of CLI command files increases startup latency; use dynamic `import()` within handlers to keep help and version checks fast.

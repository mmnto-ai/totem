## Lesson — Use join over resolve for paths

**Tags:** security, nodejs
**Scope:** packages/core/src/strategy-resolver.ts

Prefer path.join over path.resolve when combining base paths with potentially untrusted inputs to mitigate path injection vulnerabilities.

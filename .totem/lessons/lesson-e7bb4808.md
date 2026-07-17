## Lesson — Sanitize terminal outputs at rendering seams

**Tags:** security, terminal, sanitization
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Sanitize untrusted repository metadata at the terminal rendering seam rather than during parsing. This prevents ANSI escape sequence injection while preserving raw data fidelity for round-trip operations.

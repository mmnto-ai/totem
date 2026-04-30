## Lesson — Preserve line breaks in terminal sanitizers

**Tags:** terminal, sanitization, dx
**Scope:** packages/core/src/terminal-sanitize.ts

Terminal sanitization helpers should preserve newline and tab characters because different call sites require specific multi-line formatting or flattening.

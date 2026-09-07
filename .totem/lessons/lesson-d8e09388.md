## Lesson — Avoid regex-based filename semantic checks

**Tags:** naming-conventions, file-system
**Scope:** .claude/hooks/**/*.mjs

Filename patterns cannot reliably distinguish sequence counters from clock stamps when both share the same digit format (e.g., four digits). Comparing lexical order against file modification time (mtime) provides a deterministic way to detect naming drift without fragile regex matching.

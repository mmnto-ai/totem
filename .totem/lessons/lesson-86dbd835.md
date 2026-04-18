## Lesson — Prefer totem-context on the preceding line; totem-ignore only works same-line

**Tags:** dx, totem
**Scope:** packages/pack-agent-security/test/**/*.ts, !**/*.test.*, !**/*.spec.*

Both `totem-ignore` (substring match) and `totem-context:` (with justification) suppress lint rules when placed on the same line as the violation. On the preceding line, the engine only honors `totem-ignore-next-line` or `totem-context:` — a plain `// totem-ignore:` on the preceding line does NOT suppress the next line. Prefer `// totem-context: <reason>` inline so both same-line and adjacent-line cases work; reserve `// totem-ignore` for same-line use without justification.

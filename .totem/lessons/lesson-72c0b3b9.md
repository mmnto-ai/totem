## Lesson — Retain internal guards for defense-in-depth

**Tags:** hooks, shell, reliability
**Scope:** .claude/settings.json, .claude/hooks/*.sh

Maintain internal regex guards within hook scripts even when using external `if` filters to ensure the gate remains effective if the configuration is downgraded or misconfigured.

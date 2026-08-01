## Lesson — Wrap hook outputs in protocol envelope

**Tags:** claude, hooks, json
**Scope:** .claude/hooks/**/*

Claude hook outputs must be wrapped in the documented `hookSpecificOutput` envelope rather than top-level keys. Failing to use the correct envelope causes the harness to silently discard the injected context while still reporting a successful execution.

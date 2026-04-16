## Lesson — Prefer mechanical local hook logic

**Tags:** architecture, llm, performance
**Scope:** .claude/hooks/**/*.sh

Avoid LLM synthesis or network calls in local hooks to minimize latency and prevent external dependencies from blocking core tool workflows.

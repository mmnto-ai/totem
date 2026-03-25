## Lesson — Ensure new context variables like configRoot are propagated

**Tags:** architecture, refactoring, cache

Ensure new context variables like configRoot are propagated to all nested orchestrator and utility calls. Failure to thread this context causes silent fallbacks to CWD, leading to inconsistent cache resolution in sub-commands like shield.

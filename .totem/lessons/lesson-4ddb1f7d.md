## Lesson — Scope task inputs to actual file reads

**Tags:** turbo, performance, dx
**Scope:** turbo.json

Avoid adding global configuration files to every task's inputs if they are only consumed by specific tasks (e.g., linting). This prevents unnecessary cache invalidation and redundant test execution when unrelated governance or config files change.

## Lesson — Avoid environment variable configuration overrides

**Tags:** security, configuration
**Scope:** .claude/hooks/gate-wrapper.cjs

Relying on environment variables for security-sensitive configurations can lead to silent fail-open vulnerabilities if the environment is manipulated. Bake configurations directly into the invocation arguments to ensure environment immunity.

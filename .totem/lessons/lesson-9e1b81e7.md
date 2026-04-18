## Lesson — Isolate monorepo-specific security allowlists

**Tags:** architecture, security

Avoid bloating shared ignore templates with internal paths to prevent leaking repository structure to consumers. Use test-level allowlists in the monorepo to handle legitimate security rule violations for internal tools.

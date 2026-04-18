## Lesson — Prioritize data-only architecture for security packs

**Tags:** architecture, security
**Scope:** packages/pack-agent-security/**/*

Maintaining security packs as data-only JSON (without loaders or Zod) simplifies distribution and preserves the 'simple pack' design even when specs suggest more complex loaders.

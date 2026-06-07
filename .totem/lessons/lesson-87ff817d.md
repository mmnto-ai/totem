## Lesson — Exclude private scopes from pnpm supply-chain checks

**Tags:** pnpm, security, ci
**Scope:** pnpm-workspace.yaml

Pnpm 11's supply-chain checks fail on unauthed metadata 404s unless the scope is added to minimumReleaseAgeExclude, even if the dependency is marked as optional.

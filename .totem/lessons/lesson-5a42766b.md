## Lesson — Use discriminated unions for resolution

**Tags:** typescript, api-design
**Scope:** packages/core/src/**/*.ts

Returning a discriminated union like StrategyRootStatus for path resolution allows callers to safely pattern-match on success without type assertions.

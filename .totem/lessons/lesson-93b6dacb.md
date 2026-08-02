## Lesson — Register modern ESM extensions in drift detectors

**Tags:** esm, drift-detection, typescript
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

File reference extractors may silently drop backticked candidates with unregistered extensions like .mts or .cts. Ensure all supported ESM extensions are explicitly registered to prevent references from rotting.

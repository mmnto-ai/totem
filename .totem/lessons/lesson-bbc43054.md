## Lesson — Centralize shared data structure validations

**Tags:** validation, data-loading, error-handling
**Scope:** tools/docs-transforms.cjs

Performing schema validations inside individual downstream transforms duplicates logic and risks partial validation coverage. Validating core properties inside the shared data loader helper ensures that any malformed artifact fails fast and loud before consumption.

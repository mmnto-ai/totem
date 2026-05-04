## Lesson — Layered strategy root resolution precedence

**Tags:** architecture, configuration, filesystem
**Scope:** packages/core/src/**/*.ts

The strategy root resolver follows a four-layer precedence (Env > Config > Sibling > Submodule) to allow flexible local development without breaking legacy submodule support.

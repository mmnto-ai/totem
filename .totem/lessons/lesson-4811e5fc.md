## Lesson — Use lazy imports for sibling modules

**Tags:** cli, architecture, performance
**Scope:** packages/cli/src/commands/**/*.ts

Mixing eager and lazy imports in CLI commands can degrade startup performance and violate architectural boundaries. Ensure sibling command modules and heavy dependencies are consistently loaded via dynamic imports.

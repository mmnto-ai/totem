## Lesson — Reference root dependencies with $TURBO_ROOT

**Tags:** turbo, monorepo
**Scope:** turbo.json

Use the '$TURBO_ROOT/' prefix in turbo.json to declare dependencies on files outside the package workspace, such as agent instructions or repository hooks. This ensures tests reading these files via root-relative paths are correctly cached.

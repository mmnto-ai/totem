## Lesson — Explicitly bind and discard catch variables

**Tags:** typescript, conventions
**Scope:** packages/core/src/compile-manifest.ts

Binding exceptions as 'err' and using 'void err' in catch blocks makes intentional fallbacks self-documenting and prevents violations of repo safety rules regarding empty catch blocks.

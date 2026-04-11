## Lesson — Export interfaces for custom error fields

**Tags:** typescript, dx
**Scope:** packages/core/src/sys/exec.ts

Export dedicated interfaces for custom properties attached to thrown errors, such as `.status` or `.stdout`. This allows consumers to perform type-safe error handling and avoids forced casting to `any` in catch blocks.

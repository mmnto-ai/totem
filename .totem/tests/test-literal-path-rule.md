---
rule: bd31e87e32cfeefd
file: .totem/lessons/lesson-example.md
---

## Should fail

```md
Always check `src/utils/config.ts` before making changes.
The database schema lives in `packages/core/schema.ts` and should not be modified.
```

## Should pass

```md
Always check the configuration module before making changes.
The database schema should not be modified directly.
Use conceptual descriptions instead of literal file paths.
```

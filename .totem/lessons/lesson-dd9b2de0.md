## Lesson — Guard against conflicting upgrade and force flags

**Tags:** cli, validation, safety
**Scope:** packages/cli/src/commands/compile.ts

Explicitly reject the combination of --upgrade and --force flags to prevent accidental cache corruption. Since --force bypasses all cache checks, it contradicts the surgical nature of an upgrade and risks unintended side effects on the rest of the rule cache.

## Lesson — Design safe opt-in file adoption

**Tags:** dx, automation, cli
**Scope:** packages/cli/**/*.ts

Only modify existing consumer files if they contain explicit opt-in markers or are completely missing. This prevents automated CLI tools from silently overwriting custom user configurations during routine updates.

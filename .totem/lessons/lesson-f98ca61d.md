## Lesson — Update summary logs after filtering items

**Tags:** dx, logging, cli
**Scope:** packages/cli/src/commands/**/*.ts

Summary logs should reflect the count of items actually processed rather than the initial array length when items are skipped via defensive guards.

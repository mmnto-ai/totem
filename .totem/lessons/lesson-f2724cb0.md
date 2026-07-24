## Lesson — Assert on joined spy arguments

**Tags:** testing, logging
**Scope:** packages/cli/src/commands/**/*.test.ts

When asserting on console or stderr spies, join all call arguments instead of inspecting only the first element. This prevents assertions from silently passing or failing when logging utilities format or split tags into separate arguments.

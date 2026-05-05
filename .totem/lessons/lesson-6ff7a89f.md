## Lesson — Prefix hook diagnostics with script identifiers

**Tags:** logging, hooks, conventions
**Scope:** .claude/hooks/**/*.js, !**/*.test.*, !**/*.spec.*

Use `[<script-name>]` instead of `[Totem Error]` for stderr diagnostics in hook helpers. The global error prefix is reserved for thrown exceptions, while script identifiers help distinguish non-fatal diagnostic output.

## Lesson — Validate CLI flag values strictly

**Tags:** cli, typescript, validation

When parsing CLI flags that should be integers, validate strictly before conversion. `parseInt("5foo")` silently returns `5`, hiding typos. Use `Number()` or check `String(num) === raw` after parsing. This is a code review guideline — do not lint-flag all `parseInt` calls.

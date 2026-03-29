## Lesson — Lightweight pattern validators must explicitly handle

**Tags:** validation, ast-grep, regex

Lightweight pattern validators must explicitly handle escaped backslashes in string literals to avoid misidentifying the end of a string and causing runtime validation failures.

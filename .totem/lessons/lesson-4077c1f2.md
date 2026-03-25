## Lesson — Explicitly handling empty strings or negated patterns like !

**Tags:** globs, validation, robustness

Explicitly handling empty strings or negated patterns like `!` during glob normalization prevents runtime crashes and ensures the compiler pipeline handles malformed input gracefully.

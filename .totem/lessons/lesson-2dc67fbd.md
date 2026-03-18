## Lesson — When creating rules to catch generic Error usage,

**Tags:** errors, pattern-matching, false-positives

When creating rules to catch generic `Error` usage, explicitly exclude project-specific error base classes or variants. This prevents the linting rule from flagging the very patterns designed to replace standard errors.

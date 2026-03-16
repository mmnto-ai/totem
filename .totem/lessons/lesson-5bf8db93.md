## Lesson — Dynamic imports should be limited to CLI command entry

**Tags:** security, architecture, nodejs

Dynamic imports should be limited to CLI command entry points to avoid security scanner flags and maintain clean dependency graphs in core utility layers. Standard top-level imports should be preferred for internal library logic to ensure predictable module resolution and simpler testing.

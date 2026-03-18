## Lesson — Dynamic imports intended for performance optimization

**Tags:** nodejs, cli, architecture

Dynamic imports intended for performance optimization should be confined to CLI command entry points rather than utility or adapter layers. This boundary maintains a clean dependency graph for internal logic and avoids triggering security scanner flags associated with lazy-loading patterns in lower-level code.

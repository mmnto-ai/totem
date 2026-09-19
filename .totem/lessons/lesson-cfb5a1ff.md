## Lesson — Assert entry keys for map synchronization

**Tags:** testing, data-structures, synchronization
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Testing only flattened map values can allow empty map entries to escape validation undetected. Explicitly asserting against the map's keys directly enforces true bidirectional equality with the target table.

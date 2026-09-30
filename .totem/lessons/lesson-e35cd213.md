## Lesson — Disclose unreadable subtrees in diagnostic sweeps

**Tags:** fs, diagnostics, traversal
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Ignoring unreadable directories during recursive sweeps can lead to false-positive clean reports. Explicitly counting and reporting unreadable subtrees ensures diagnostic accuracy.

## Lesson — Avoid quadratic string prepending in loops

**Tags:** performance, typescript, string-manipulation
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Prepending characters one-by-one in a loop to extract a string tail causes O(n²) allocations. Collect characters in reverse into an array and join them once to maintain linear performance.

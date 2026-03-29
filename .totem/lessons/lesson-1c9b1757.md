## Lesson — Avoid calling extraction helpers multiple times on the same

**Tags:** performance, refactoring

Avoid calling extraction helpers multiple times on the same source body by passing pre-parsed data into downstream verification functions. This prevents redundant parsing overhead during rule testing.

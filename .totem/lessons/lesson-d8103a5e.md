## Lesson — Avoid refactoring production for test ergonomics

**Tags:** testing, architecture
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Prioritize production code cleanliness over test ergonomics by using global spies (e.g., vi.spyOn) instead of forcing dependency injection for simple probes.

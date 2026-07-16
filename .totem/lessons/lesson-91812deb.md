## Lesson — Omit missing environment fields over guessing

**Tags:** configuration, environment, best-practices
**Scope:** packages/cli/**/*.ts, !**/*.test.*

When an attribution field is derived from an environment variable, omit the field entirely if the variable is absent rather than guessing a default. This prevents incorrect fallback values and maintains strict data fidelity.

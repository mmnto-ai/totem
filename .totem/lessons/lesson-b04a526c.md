## Lesson — Avoid the cached-failed-optional pnpm trap

**Tags:** pnpm, dependencies, devops

Use explicit 'pnpm add' when bumping dependency pins to clear potential cached failure states from previous optional dependency resolution attempts that may persist in the lockfile.

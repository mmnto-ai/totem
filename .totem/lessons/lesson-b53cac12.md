## Lesson — Avoid re-exporting internal building blocks or heuristics

**Tags:** architecture, api-design, semver

Avoid re-exporting internal building blocks or heuristics from a package root as stable entry points. Exposing lower-level helpers makes future logic tuning semver-sensitive and complicates the public API maintenance.

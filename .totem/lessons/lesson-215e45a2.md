## Lesson — Drift detector flags lesson file path mentions

**Tags:** style, curated
**Pattern:** \b[\w.-]+\/[\w.-]+\.[a-z0-9]{2,}\b
**Engine:** regex
**Scope:** .totem/lessons/**, .totem/lessons.md
**Severity:\*\* warning

Avoid using literal file paths in lessons (e.g., 'src/config.ts'). Use conceptual descriptions instead (e.g., 'the configuration file') to prevent drift detector errors when files are moved or renamed.

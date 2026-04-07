## Lesson — Proactively remove references to planned features from user

**Tags:** style, curated
**Pattern:** \b(coming soon|planned (feature|for)|future release|roadmap|under development|slated for|later development phases)\b
**Engine:** regex
**Scope:** **/*.md, **/*.mdx, docs/**/*, guides/**/*, !docs/roadmap.md, !docs/wiki/roadmap.md, !docs/active_work.md
**Severity:** warning

Proactively remove references to planned features from user-facing guides. Excludes the project's own roadmap files (`docs/roadmap.md`, `docs/wiki/roadmap.md`) and internal tracking (`docs/active_work.md`), where the literal word "roadmap" and references to upcoming work are by-design.

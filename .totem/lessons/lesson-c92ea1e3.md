## Lesson — Proactively remove references to planned features from user

**Tags:** style, curated
**Pattern:** \b(coming soon|planned (feature|for)|future release|roadmap|under development|slated for|later development phases)\b
**Engine:** regex
**Scope:** **/*.md, **/*.mdx, docs/**/*, guides/**/*, !docs/wiki/roadmap.md
**Severity:** warning

Proactively remove references to planned features from user-facing guides. The project's own roadmap file is excluded via the Scope negation above, where the literal word "roadmap" and references to upcoming work are by-design.

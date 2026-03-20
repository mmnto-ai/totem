## Lesson — Junie requires specific file locations for auto-detection,

**Tags:** architecture, curated
**Pattern:** \.junie\/(?!mcp\/mcp\.json|guidelines\.md)[^'"\s>]+\.(json|md)
**Engine:** regex
**Scope:** **/*.js, **/*.ts, **/*.json, **/*.md, **/*.sh, **/*.yml, **/*.yaml, .gitignore
**Severity:** warning

Junie requires specific file locations for auto-detection.

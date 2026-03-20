## Lesson — Resolve git root via rev-parse for monorepo compatibility

**Tags:** style, curated
**Pattern:** (-d\s+['"]?\.git['"]?|existsSync\([^)]*['"]\.git['"]\))
**Engine:** regex
**Scope:** **/*.sh, **/*.bash, **/*.js, **/*.ts, **/*.yml, **/*.yaml
**Severity:** warning

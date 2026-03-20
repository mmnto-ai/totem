## Lesson — Always use fully qualified identifiers for caching

**Tags:** architecture, curated
**Pattern:** \b(cacheKey|telemetryId|modelId)\s*[:=]\s*['"][^'"\s:]+['"]
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx, !**/*.test.ts, !**/*.test.js
**Severity:** error

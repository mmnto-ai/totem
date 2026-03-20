## Lesson — Always use fully qualified identifiers for caching

**Tags:** architecture, curated
**Pattern:** \b(cacheKey|telemetryId|modelId)\s*[:=]\s*['"][^'"\s:]+['"]
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx, !**/_.test.ts, !\*\*/_.test.js
**Severity:** error

Always use fully qualified identifiers (e.g., 'provider:model') for caching and telemetry to prevent cross-provider collisions.

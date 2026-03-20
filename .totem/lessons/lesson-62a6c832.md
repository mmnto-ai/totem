## Lesson — GCA may suggest reverting dynamic imports back to static

**Tags:** performance, curated
**Pattern:** import\s+(?!type\s).*\s+from\s+['"]@mmnto/totem['"]
**Engine:** regex
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts
**Severity:** warning

GCA may suggest reverting dynamic imports back to static.

## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** architecture, curated
**Pattern:** \$\{\s*err\s*\}
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** warning

Decorative UI (branding tags, colors, banners) must be routed to stderr. Use the log.\* helpers or console.error to reserve stdout for pipeable data.

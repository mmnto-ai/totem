## Lesson — 2026-03-05T04:05:19.420Z

**Tags:** architecture, curated
**Pattern:** const\s+\w+\s*=\s*/(?![\^])https\?:
**Engine:** regex
**Scope:** packages/cli/**/*.ts, !**/*.test.ts
**Severity:** error

URL regex patterns must anchor with ^ to prevent partial matches on malicious input.

## Lesson — 2026-03-05T04:05:19.420Z

**Tags:** architecture, curated
**Pattern:** const\s+\w+\s*=\s*/(?![^])https\?:
**Engine:** regex
**Scope:** packages/cli/**/\*.ts, !**/\*.test.ts
**Severity:** error

Anchor input regexes with '^' and include 'https?://' protocol to avoid substring matches in CLI input.

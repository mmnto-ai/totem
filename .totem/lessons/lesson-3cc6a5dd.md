## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** architecture, curated
**Pattern:** \b(console\.(log|info)|process\.stdout\.write)\s*\(.*(\[Totem\]|\b(brand|success|warn|errorColor|dim|bold|BANNER)\b|pc\.)
**Engine:** regex
**Scope:** packages/cli/**/\*.ts, !**/\*.test.ts
**Severity:** error

Decorative UI (branding tags, colors, banners) must be routed to stderr. Use the log.\* helpers or console.error to reserve stdout for pipeable data.

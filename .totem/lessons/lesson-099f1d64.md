## Lesson — Swallowing errors in core modules hides silent failures,

**Tags:** architecture, curated
**Pattern:** \bconsole\.(log|warn|error|info|debug)\(
**Engine:** regex
**Scope:** **/core/**/_.ts, **/core/**/_.js, !**/\*.test.ts
**Severity:\*\*\*\* warning

Avoid direct console logging in core modules to prevent environment coupling. Use optional onWarn callbacks instead.

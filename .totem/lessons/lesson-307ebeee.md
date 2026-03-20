## Lesson — 2026-03-05T04:05:16.794Z

**Tags:** architecture, curated
**Pattern:** \.(includes|startsWith)\(['"]\\\[Totem Error\\\]['"]\)
**Engine:** regex
**Scope:** **/\*.ts, **/_.tsx, \*\*/_.js, **/\*.jsx, !**/error*.ts, !\*\*/error*.js
**Severity:** error

Error re-throw guards (checking for '[Totem Error]') should be centralized in the shared error handler, not duplicated at call sites.

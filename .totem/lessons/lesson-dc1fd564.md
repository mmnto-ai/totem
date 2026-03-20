## Lesson — Detect existing hook managers and provide manual guidance

**Tags:** architecture, curated
**Pattern:** \.git\/hooks
**Engine:** regex
**Scope:** **/\*.js, **/_.ts, \*\*/_.sh, **/\*.bash, **/_.py, \*\*/_.rb, **/\*.go, !**/_.test.ts, !\*\*/_.spec.ts
**Severity:** warning

Avoid writing directly to .git/hooks. Detect existing hook managers (like Husky or Lefthook) and provide manual guidance instead to prevent clobbering developer workflows.

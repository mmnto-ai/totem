## Lesson — When reading cache or config files, specifically check

**Tags:** architecture, curated
**Pattern:** \.catch\(\s*[^)]*\)\s*=>\s*(?!.*ENOENT)[^\{\s]+|\bcatch\s*\{
**Engine:** regex
**Scope:** **/*config*.*, **/*cache*.*
**Severity:** warning

When reading cache or config files, specifically check.

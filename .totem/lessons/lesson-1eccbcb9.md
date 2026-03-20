## Lesson — When reading cache or config files, specifically check

**Tags:** architecture, curated
**Pattern:** \.catch\(\s*[^)]*\)\s*=>\s*(?!.*ENOENT)[^\{\s]+|\bcatch\s*\{
**Engine:** regex
**Scope:** **/*config*.*, **/*cache*.*
**Severity:** warning

When reading cache or config files, specifically check for the 'ENOENT' error code to handle missing files silently. Swallowing all errors (e.g., via a bindingless catch or a generic return) hides critical issues like file permissions or JSON corruption.

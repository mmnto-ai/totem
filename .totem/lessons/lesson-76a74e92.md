## Lesson — Check for the presence of the global ('g') flag

**Tags:** architecture, curated
**Pattern:** new\s+RegExp\s*\(\s*[^,]+\s*,\s*[^,]*\.flags\s*\+\s*['"][^'"]*g
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx
**Severity:** error

Do not append the 'g' flag to existing RegExp flags without checking for its presence; duplicate flags cause a runtime SyntaxError in JavaScript.

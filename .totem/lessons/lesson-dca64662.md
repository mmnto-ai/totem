## Lesson — When catching and re-logging errors that originate

**Tags:** style, curated
**Pattern:** (['"`])\[[^\]]+\]._?\b(err|error)\.message\b(?!._\.replace)
**Engine:** regex
**Scope:** **/\*.ts, **/_.js, \*\*/_.tsx, **/\*.jsx
**Severity:\*\*\*\* warning

When re-logging errors with a context prefix (e.g., '[Docs]'), strip redundant internal prefixes (e.g., '[Totem Error]') from the error message using .replace() to keep logs clean.

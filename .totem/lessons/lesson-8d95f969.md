## Lesson — GitHub Actions shell injection via template expressions

**Tags:** security, curated
**Pattern:** (?:^\s*-?\s*run\b|^(?!\s*[\w-]+:\s)\s+).*\$\{\{\s*(github\.event|inputs)\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/*.yml, .github/workflows/*.yaml
**Severity:** error

GitHub Actions shell injection via template expressions.

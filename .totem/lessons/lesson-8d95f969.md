## Lesson — GitHub Actions shell injection via template expressions

**Tags:** security, curated
**Pattern:** \$\{\{\s*(github\.event|inputs)\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/*.yml, .github/workflows/*.yaml
**Severity:** error

GitHub Actions shell injection via template expressions.

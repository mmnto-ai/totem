## Lesson — GitHub Actions shell injection via template expressions

**Tags:** security, curated
**Pattern:** \$\{\{\s*(github\.event|inputs)\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/_.yml, .github/workflows/_.yaml
**Severity:** error

Potential shell injection: Never use github.event or inputs directly in 'run' blocks. Map them to environment variables first and reference them as "$VAR".

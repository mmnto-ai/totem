## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** security, curated
**Pattern:** (?:\brun:|^\s*[^:\s]+\s+).*\$\{\{\s*inputs\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/*.yml, .github/workflows/*.yaml
**Severity:** error

GitHub Actions workflow inputs must be sanitized before use in shell commands.

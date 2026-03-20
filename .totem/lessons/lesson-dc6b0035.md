## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** security, curated
**Pattern:** (?:\brun:|^\s*[^:\s]+\s+).*\$\{\{\s*inputs\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/*.yml, .github/workflows/*.yaml
**Severity:** error

Always quote shell variables (e.g., "$VAR") to prevent word-splitting and argument injection.

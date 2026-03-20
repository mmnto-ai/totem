## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** style, curated
**Pattern:** (?:\brun:|^\s*[^:\s]+\s+).*\$\{\{\s*inputs\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/*.yml, .github/workflows/*.yaml
**Severity:** error

Untrusted text (LLM/PR content) must be wrapped in `sanitize()` before display in CLI to prevent terminal injection.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** security, curated
**Pattern:** (?:\brun:|^\s*[^:\s]+\s+).*\$\{\{\s*inputs\..*\}\}
**Engine:** regex
**Scope:** .github/workflows/_.yml, .github/workflows/_.yaml
**Severity:** error

Directly expanding ${{ inputs.key }} in shell scripts is a command injection risk. Map to an environment variable in the 'env' section first and use the environment variable in your script.

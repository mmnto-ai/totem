## Lesson — When intercepting agent tool inputs via hooks, use specific

**Tags:** architecture, curated
**Pattern:** (\.(match|test|includes)\s*\(|pattern:\s*)[/"']\^?\b(git|npm|docker|aws|kubectl|gh|sh|bash)\b\$?[/"']
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts
**Severity:** error

When intercepting agent tool inputs via hooks, use specific.

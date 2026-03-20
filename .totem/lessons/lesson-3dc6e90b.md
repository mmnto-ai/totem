## Lesson — When intercepting agent tool inputs via hooks, use specific

**Tags:** architecture, curated
**Pattern:** (\.(match|test|includes)\s*\(|pattern:\s*)[/"']\^?\b(git|npm|docker|aws|kubectl|gh|sh|bash)\b\$?[/"']
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts
**Severity:** error

Broad keyword matching for tool hooks (e.g., /git/) causes false positives. Use specific regex patterns that include both the command and sub-arguments (e.g., /git\s+(push|commit)/).

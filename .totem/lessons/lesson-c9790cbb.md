## Lesson — When manually parsing CLI arguments, verify that a flag's

**Tags:** architecture, curated
**Pattern:** [\w.]+\s*\[[^\]]*\.indexOf\(.+?\)\s*\+\s*1\s*\]
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.mjs, **/*.cjs
**Severity:** error

Manual CLI flag parsing via indexOf + 1 is unsafe. Verify the value exists and does not start with a hyphen to avoid interpreting the next flag as its parameter.

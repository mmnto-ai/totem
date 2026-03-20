## Lesson — When mapping violations to rules in SARIF generation,

**Tags:** architecture, curated
**Pattern:** \bruleIndex\b.*(\?\?|\|\|)\s*0
**Engine:** regex
**Scope:** **/*sarif*/**/*.ts, **/sarif/**/*.ts
**Severity:** error

Do not use a default index (0) for SARIF rule mapping. Trigger a hard error if the rule index is not found to prevent misleading reports.

## Lesson — Always generate sentinel markers even when the internal

**Tags:** style, curated
**Pattern:** \btext:\s*['"]['"]
**Engine:** regex
**Scope:** packages/mcp/**/*.ts, !**/*.test.ts
**Severity:** warning

Always generate sentinel markers even when the internal content is empty. Returning an empty string instead of empty markers causes the replacement logic to delete the markers from the target file, leading to redundant appends.

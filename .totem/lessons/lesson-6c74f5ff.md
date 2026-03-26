## Lesson — Perform explicit null and type checks on the results

**Tags:** typesafety, nodejs, json
**Engine:** ast-grep
**Severity:** warning
**Scope:** **/*.ts, **/*.tsx, !**/registry.ts
**Pattern:** `JSON.parse($A) as $B`

Perform explicit null and type checks on the results of `JSON.parse` for lock files before accessing properties like `pid`. Direct type assertions (`as LockData`) can mask `TypeError` risks if a lock file is concurrently truncated, malformed, or empty. Note: `JSON.parse(x) as unknown` followed by Zod safeParse is a valid defensive pattern — the ast-grep pattern cannot distinguish this case, so validated files are scope-excluded.

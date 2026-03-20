## Lesson — 2026-03-07T06:05:56.069Z

**Tags:** security, curated
**Pattern:** \b(wrapXml|sanitize)\s*\(\s*([^,)]_?\b(branch|filePath|path|cwd)\b[^,)]_?)\s*[\),]
**Engine:** regex
**Scope:** packages/cli/\*\*/*.ts, !**/\*.test.ts
**Severity:\*\* error

Do not sanitize or XML-wrap semi-trusted metadata like branch names or git file paths in prompts to avoid unnecessary clutter (Totem principle).

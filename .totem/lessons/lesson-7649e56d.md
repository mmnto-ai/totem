## Lesson — LLMs are notoriously poor at character counting; use

**Tags:** style, curated
**Pattern:** \b\d+\s*(?:characters?|chars?|words?)\b
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.py, **/*.md, **/*.txt
**Severity:** warning

LLMs are poor at character counting; use semantic constraints (e.g., 'one to two short sentences') instead of numeric limits.

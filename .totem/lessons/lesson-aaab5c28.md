## Lesson — Use --body-file for LLM text in CLI

**Tags:** security, curated
**Pattern:** \b--body\b(?!-file)
**Engine:** regex
**Scope:** *.sh, *.bash, *.yml, *.yaml, packages/cli/**/*.ts
**Severity:** error

Use --body-file instead of --body to prevent shell injection and escaping issues with LLM-generated text.

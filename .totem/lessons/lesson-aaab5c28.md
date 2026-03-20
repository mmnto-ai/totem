## Lesson — Use --body-file for LLM text in CLI

**Tags:** security, curated
**Pattern:** \b--body\b(?!-file)
**Engine:** regex
**Scope:** _.sh, _.bash, _.yml, _.yaml, packages/cli/**/\*.ts
**Severity:\*\* error

Use --body-file instead of --body to prevent shell injection and escaping issues with LLM-generated text.

## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** style, curated
**Pattern:** \b(console\.(log|error)|log\.(info|success|warn|error|dim)|spinner\.(update|succeed|fail))\s*\((?!.*sanitize\()._\b(lesson|snippet|result|body|comment|response|output)s?\b
**Engine:** regex
**Scope:** packages/cli/\*\*/_.ts, !**/\*.test.ts
**Severity:\*\*\*\* warning

Untrusted text (LLM/PR content) must be wrapped in `sanitize()` before display in CLI to prevent terminal injection.

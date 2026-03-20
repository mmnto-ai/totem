## Lesson — When normalizing diverse SDK errors for internal retry

**Tags:** style, curated
**Pattern:** throw\s+new\s+\w*Error\s*\(\s*.*\b(e|err|error)\b
**Engine:** regex
**Scope:** **/services/**/*, **/clients/**/*, **/integrations/**/*, **/sdk/**/*, **/adapters/**/*
**Severity:** warning

When normalizing diverse SDK errors for internal retry.

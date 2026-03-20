## Lesson — When normalizing diverse SDK errors for internal retry

**Tags:** style, curated
**Pattern:** throw\s+new\s+\w*Error\s*\(\s*.*\b(e|err|error)\b
**Engine:** regex
**Scope:** **/services/**/*, **/clients/**/*, **/integrations/**/*, **/sdk/**/*, **/adapters/**/*
**Severity:** warning

When normalizing SDK errors, mutate the original error's .name property and re-throw it instead of creating a new Error instance. This preserves the original stack trace and provider-specific metadata.

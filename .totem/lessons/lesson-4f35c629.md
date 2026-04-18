## Lesson — Assert per-family coverage for compound rules

**Tags:** testing, security
**Scope:** packages/pack-agent-security/test/**/*.ts

When testing rules with multiple sub-patterns (like obfuscation), assert that each distinct family triggers a match to prevent silent regressions in specific detection logic.

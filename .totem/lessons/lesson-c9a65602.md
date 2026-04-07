## Lesson — Skip ReDoS checks for structural patterns

**Tags:** security, regex, ast-grep
**Scope:** scripts/benchmark-compile.ts

Structural engines like ast-grep are inherently immune to ReDoS, allowing them to bypass the complex safety validation required for regex-based patterns.

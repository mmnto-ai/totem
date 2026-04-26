## Lesson — Avoid simple comma splitting for globs

**Tags:** glob, parsing
**Scope:** packages/core/src/lesson-pattern.ts

Splitting glob strings by commas breaks brace expansion patterns like `{ts,tsx}`; parsers must respect top-level commas while ignoring those inside braces.

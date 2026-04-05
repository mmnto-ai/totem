## Lesson — Use bracket notation for reserved keys

**Tags:** typescript, linting, dx
**Scope:** packages/cli/src/index-lite.ts

Assigning values to reserved keys via bracket notation (e.g., payload['error']) avoids triggering specific lint rules like id-match, removing the need for inline suppressions.

## Lesson — Match Prettier formatting in template literals

**Tags:** formatting, prettier, testing, typescript
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Parity tests enforcing byte-identity between markdown files and TypeScript template literals can fail because Prettier formats standalone files but cannot reach inside TS string constants. To avoid this, manually align the template literal's formatting to match Prettier's output exactly.

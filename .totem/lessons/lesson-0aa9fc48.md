## Lesson — Prefer Vitest options object over positional timeouts

**Tags:** vitest, prettier, formatting
**Scope:** packages/**/*.test.ts

When overriding timeouts for a specific suite or test, pass an options object (e.g., `{ timeout: 60000 }`) instead of a third positional numeric argument. Prettier formats the positional form by re-indenting the entire suite body, causing unnecessary git diff noise.

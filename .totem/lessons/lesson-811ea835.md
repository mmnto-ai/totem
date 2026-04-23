## Lesson — Initialize working sets from existing data

**Tags:** durability, cli
**Scope:** packages/cli/src/commands/compile.ts

Initialize working sets as a copy of existing data even during forced updates to prevent data loss if transient failures like network timeouts or rate limits occur mid-process.

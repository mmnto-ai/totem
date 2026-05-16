## Lesson — Handle Zod enum failures for forward compatibility

**Tags:** zod, compatibility
**Scope:** packages/cli/src/commands/**/*.ts

Zod safeParse will fail entirely on unknown enum values; consumers must handle these failures gracefully to maintain compatibility with newer, unrecognized event types.

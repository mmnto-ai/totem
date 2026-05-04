## Lesson — Delete undefined env vars in tests

**Tags:** testing, node.js
**Scope:** packages/cli/src/commands/doctor.test.ts

When mocking environment variables, the afterEach cleanup must explicitly delete keys that were originally undefined. Assigning undefined to a process.env key can leak state or cause unexpected behavior in environments that check for key existence.

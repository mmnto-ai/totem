## Lesson — Fail-close unknown extensions to code

**Tags:** security, classification
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Unknown file extensions should fail-close and be classified as code to prevent bypassing security or classification gates. Explicitly register all supported extensions to make intent inspectable and resilient to default changes.

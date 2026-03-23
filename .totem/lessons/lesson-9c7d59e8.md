## Lesson — Replacing direct process.exit(1) calls with thrown custom

**Tags:** cli, testing, node

Replacing direct process.exit(1) calls with thrown custom errors makes command logic composable and unit-testable. Centralize exit code handling at the top-level application boundary to maintain control over the execution lifecycle.

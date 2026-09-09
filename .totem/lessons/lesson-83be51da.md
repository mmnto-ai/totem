## Lesson — Verify multiple indicators for bot detection

**Tags:** github-api, security, bot-detection
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Relying solely on login names to identify GitHub bots can allow App integrations to be misclassified as human. Check the GraphQL `typename`, the `[bot]` suffix, and explicit identity lists to ensure robust bot detection.

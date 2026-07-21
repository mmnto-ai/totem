## Lesson — Use GraphQL for repository merge settings

**Tags:** github-api, graphql, workflows
**Scope:** tools/**/*.mjs

The GitHub REST API omits merge-policy fields for non-admin callers (such as standard GitHub Actions tokens), whereas the GraphQL API allows reading these settings with a plain read-only token.

## Lesson — Provision npm scopes before first publish

**Tags:** npm, devops, ci-cd
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

npm scopes must be manually provisioned before a CI/CD workflow attempts to publish, as tools like changesets will fail with E404 if the namespace does not exist on the registry.

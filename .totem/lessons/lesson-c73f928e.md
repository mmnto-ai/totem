## Lesson — Provision npm scopes before first publish

**Tags:** npm, devops, ci-cd
**Scope:** **/package.json, .github/workflows/*.yml, .changeset/config.json

npm scopes must be manually provisioned before a CI/CD workflow attempts to publish, as tools like changesets will fail with E404 if the namespace does not exist on the registry. Surface this guidance when developers modify `package.json`, changeset config, or release workflows — those are the artefacts that trigger the publish path.

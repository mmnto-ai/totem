## Lesson — Verify label absence before deletion

**Tags:** github-api, automation, data-safety
**Scope:** scripts/sync-labels.ps1

When migrating GitHub labels, verify that no issue or PR still carries the legacy label before executing the destructive delete, and read that verification from the issues and pulls endpoints rather than the search index, which lags behind writes and can report a stale count (mmnto-ai/totem#2849 corrected the run that blamed a 1000-issue cap). A label delete strips PRs as well as issues, so a migration that moved issues only still loses the PRs' label.

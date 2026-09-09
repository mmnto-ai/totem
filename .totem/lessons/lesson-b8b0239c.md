## Lesson — Verify CLI deletions

**Tags:** cli, automation, error-handling
**Scope:** scripts/sync-labels.ps1

Command-line deletions can fail for reasons other than the resource already being absent. Verifying the deletion by querying the resource's existence prevents false-positive convergence reports when a delete command fails silently.

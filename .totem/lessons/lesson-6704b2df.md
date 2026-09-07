## Lesson — Check exit status of suppressed commands

**Tags:** powershell, ci-cd, error-handling
**Scope:** scripts/**/*.ps1

When suppressing stderr (e.g., `2>$null`) to ignore expected errors like resource-already-exists, you must explicitly check the command's exit status or `$LASTEXITCODE`. Otherwise, critical failures like authentication or permission issues will fail silently and report false success.

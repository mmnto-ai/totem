## Lesson — Implementing bypass logic via GitHub Actions contains()

**Tags:** github-actions, security, devops

Implementing bypass logic via GitHub Actions `contains()` expressions instead of shell-based parsing prevents potential shell injection surfaces. This ensures that PR metadata cannot be manipulated to execute arbitrary code during security gate checks.

## Lesson — Treat non-success states as workflow failures

**Tags:** github-actions, ci, monitoring
**Scope:** .github/workflows/**/*.yml

GitHub Actions maps timeout expiries to cancellation rather than failure, meaning a hung job could resolve silently. Alert scripts must treat any state other than success or skipped as red to prevent silent failures.

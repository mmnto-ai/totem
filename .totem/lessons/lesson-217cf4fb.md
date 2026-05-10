## Lesson — Route stderr to stdout for hooks

**Tags:** claude, cli, dx
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Redirecting `stderr` to `stdout` in AI session hooks ensures that orientation banners or diagnostic output are visible in the AI's prompt context rather than being hidden in system logs.

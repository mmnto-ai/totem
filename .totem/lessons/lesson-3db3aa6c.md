## Lesson — Use pre-push hooks for project-wide formatting

**Tags:** git-hooks, dx, formatting
**Scope:** packages/cli/src/commands/install-hooks.ts

Pre-commit hooks often target only staged files for speed; using a pre-push hook to run a full format check catches unformatted non-code files like docs or JSON before they reach CI.

## Lesson — Lockfile mutations require auth for optional dependencies

**Tags:** pnpm, dx, contributing
**Scope:** CONTRIBUTING.md

Commands that mutate the lockfile (like pnpm add/update) require registry auth to resolve metadata for all dependencies, including optional ones that frozen-lockfile installs would skip.

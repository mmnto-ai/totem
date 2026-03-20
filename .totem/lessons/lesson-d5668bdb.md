## Lesson — Automated gates like pre-commit or pre-push hooks

**Tags:** architecture, curated
**Pattern:** \bshield\b(?!.*--deterministic)
**Engine:** regex
**Scope:** .pre-commit-config.yaml, .husky/**/*, package.json, lint-staged.config.*, .lintstagedrc*, Makefile, *.sh
**Severity:** error

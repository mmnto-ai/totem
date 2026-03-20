## Lesson — Automated gates like pre-commit or pre-push hooks

**Tags:** architecture, curated
**Pattern:** \bshield\b(?!._--deterministic)
**Engine:** regex
**Scope:** .pre-commit-config.yaml, .husky/\*\*/_, package.json, lint-staged.config._, .lintstagedrc_, Makefile, \*.sh
**Severity:** error

Automated gates must use 'shield --deterministic' to avoid LLM latency and operational costs in pre-commit/pre-push hooks.

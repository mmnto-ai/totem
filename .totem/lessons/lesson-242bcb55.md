## Lesson — Narrow GHA injection rules to execution contexts

**Tags:** github-actions, security, regex
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

GitHub Actions substitutes expressions in `env:` and `with:` blocks before shell execution, making them safe from injection. Lint rules should target execution keys like `run:` or `shell:` to avoid false positives in safe YAML contexts.

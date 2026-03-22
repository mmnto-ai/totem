## Lesson — Avoid applying strict linting rules, such as empty catch

**Tags:** linting, ast-grep, scripts

Avoid applying strict linting rules, such as empty catch block prohibitions, to dev-only diagnostic or "throwaway" scripts. These scripts often prioritize resilience and simplicity over production-grade error handling, making strict audits a source of false positives.

## Lesson — Verify CLI availability in shared git hooks before execution

**Tags:** architecture, curated
**Pattern:** ^[ \t]*(?!(?:if|command|type|hash|\[|&&|\|\|)\b)\s*(npx|pnpm|npm|yarn|eslint|prettier|lint-staged|tsc|vitest|jest|oxlint|biome|stylelint)\b
**Engine:** regex
**Scope:** .husky/**/*, .githooks/**/*, scripts/hooks/**/*, **/*.sh, **/*.bash
**Severity:** error

Verify CLI availability in shared git hooks before execution.

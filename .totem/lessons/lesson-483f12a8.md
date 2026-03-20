## Lesson — Verify CLI availability in shared git hooks before execution

**Tags:** architecture, curated
**Pattern:** ^[ \t]_(?!(?:if|command|type|hash|\[|&&|\|\|)\b)\s_(npx|pnpm|npm|yarn|eslint|prettier|lint-staged|tsc|vitest|jest|oxlint|biome|stylelint)\b
**Engine:** regex
**Scope:** .husky/**/\*, .githooks/**/_, scripts/hooks/\*\*/_, **/\*.sh, **/\*.bash
**Severity:** error

Verify CLI availability (e.g., using 'command -v' or 'tool --version') before execution in git hooks to prevent brittle CI failures.

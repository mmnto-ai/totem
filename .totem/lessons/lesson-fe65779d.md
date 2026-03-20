## Lesson — Perform shell-level existence checks before invoking CLI

**Tags:** performance, curated
**Pattern:** ^(npx|node|npm|pnpm|yarn|bun)\b
**Engine:** regex
**Scope:** .husky/_, .git/hooks/_
**Severity:** warning

Perform shell-level existence checks (e.g., [ -f config.json ]) before invoking heavy CLI tools in git hooks to avoid Node.js overhead.

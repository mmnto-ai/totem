## Lesson — Use git adapter instead of raw git execution

**Tags:** architecture, curated
**Pattern:** (?:execFileSync|safeExec)\(\s*['"`]git['"`]
**Engine:** regex
**Scope:** **/*.ts, !packages/core/src/sys/git.ts, !**/*.test.ts, !**/*.spec.ts
**Severity:** warning

Use the git adapter functions from `@mmnto/totem` (e.g., `getGitBranch`, `getGitDiff`, `resolveGitRoot`) instead of calling git directly via `execFileSync` or `safeExec`. The shared git adapter handles cross-platform shell requirements, timeout defaults, maxBuffer limits, and structured error handling with cause chains. Raw git calls lead to duplicated boilerplate and inconsistent error behavior.

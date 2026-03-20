## Lesson — Resolve git root via rev-parse for monorepo compatibility

**Tags:** style, curated
**Pattern:** (-d\s+['"]?\.git['"]?|existsSync\([^)]_['"]\.git['"]\))
**Engine:** regex
**Scope:** \*\*/_.sh, **/\*.bash, **/_.js, \*\*/_.ts, **/\*.yml, **/\*.yaml
**Severity:** warning

Always resolve the git repository root via 'git rev-parse --show-toplevel' instead of checking for a .git directory. This ensures compatibility with monorepos, submodules, and worktrees.

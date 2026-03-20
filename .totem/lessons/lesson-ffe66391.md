## Lesson — Changesets interactive CLI (pnpm changeset) crashes when

**Tags:** architecture, curated
**Pattern:** \bpnpm\s+changeset\b(?!\s+(version|publish|status|pre|tag|init))
**Engine:** regex
**Scope:** .github/workflows/**/\*.yml, .circleci/config.yml, **/scripts/_.sh, \*\*/scripts/_.bash, Makefile
**Severity:** error

The interactive 'pnpm changeset' command crashes in non-TTY/CI environments. For automated releases, write changeset files manually to .changeset/ or use non-interactive commands.

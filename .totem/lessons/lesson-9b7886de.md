## Lesson — Place Git revisions before double-dash separator

**Tags:** git, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When constructing `git diff` or other Git commands, place revision arguments before the `--` separator to prevent Git from misinterpreting them as pathspecs.

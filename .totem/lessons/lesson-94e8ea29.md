## Lesson — Pin merge commands to evaluated commits

**Tags:** git, github-actions, security
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

When performing pre-merge validations, always pin the subsequent merge command to the evaluated snapshot using `--match-head-commit`. This prevents race conditions where the PR head changes between the evaluation and execution phases.

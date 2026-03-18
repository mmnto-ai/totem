## Lesson — Use the core package's glob matching logic

**Tags:** architecture, devops, glob

Use the core package's glob matching logic when pre-filtering Git diffs in CI/CD commands to maintain behavioral parity. Reusing central matching logic prevents "CI noise" where submodules or ignored patterns are incorrectly processed by divergent local logic.

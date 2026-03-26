## Lesson — Using simple substring matching like "git" && "commit"

**Tags:** bash, git, regex

Using simple substring matching like `*"git"* && *"commit"*` in shell hooks can trigger false positives on unrelated commands; order-sensitive regex ensures the gate only activates for actual Git subcommands.

## Lesson — When intercepting agent tool inputs via hooks, use specific

**Tags:** regex, devtools, security

When intercepting agent tool inputs via hooks, use specific regex patterns that look for both the command and its sub-arguments (e.g., `git` AND `push|commit`) to prevent false positives. Broad keyword matching can accidentally trigger hooks on natural language phrases that happen to contain reserved command names.

## Lesson — Shell hooks should use word-boundary regex instead

**Tags:** shell, git, security

Shell hooks should use word-boundary regex instead of simple string matching to correctly identify commands like 'commit' or 'push'. This ensures that git flags (e.g., 'git -c ... commit') are handled correctly and prevents false positives on substrings.

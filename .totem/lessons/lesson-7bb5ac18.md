## Lesson — Use 'set -f' (noglob) when passing cached glob patterns

**Tags:** git, shell, security

Use 'set -f' (noglob) when passing cached glob patterns to git commands to prevent the shell from expanding them into local filenames before Git processes the pathspec.

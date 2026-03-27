## Lesson — Trimming output from commands like 'git ls-files -z'

**Tags:** git, shell, nodejs

Trimming output from commands like 'git ls-files -z' or 'git show' can corrupt NUL-delimited paths or strip intentional file whitespace. Always pass trim: false to execution wrappers when the raw output format must be preserved.

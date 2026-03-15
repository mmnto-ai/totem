## Lesson — Static analysis tools should read file content using git

**Tags:** git, ast, static-analysis

Static analysis tools should read file content using `git show :path` to access the staged index version rather than the local disk. This ensures the analysis accurately reflects the actual commit content and ignores unstaged "dirty" changes.

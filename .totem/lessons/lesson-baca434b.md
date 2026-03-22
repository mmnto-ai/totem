## Lesson — When matching function calls with ast-grep, multiple

**Tags:** ast-grep, pattern-matching

When matching function calls with ast-grep, multiple patterns or combinators are required to capture both inline literals and variable-based arguments. A single pattern like `spawn($CMD, [$$$ARGS])` will fail to match calls using variable references for arguments.

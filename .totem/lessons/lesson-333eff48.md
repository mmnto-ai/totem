## Lesson — Structural patterns like spawn($CMD, [$$$ARGS]) often only

**Tags:** ast-grep, linting, patterns

Structural patterns like `spawn($CMD, [$$$ARGS])` often only match explicit array literals. To capture variable-based arguments, developers must use specific capture variables or combinators that account for references rather than just literal structures.

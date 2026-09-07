## Lesson — Keep parser-targeted lines unrefactored

**Tags:** parsing, regex, tooling
**Scope:** scripts/**/*.ps1

When external tools parse source code files using rigid line-by-line regex, avoid refactoring those lines into loops or helper functions. Keeping the literal, repetitive line shapes intact prevents breaking AST-less parsers that rely on static patterns.

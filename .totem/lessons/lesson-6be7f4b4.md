## Lesson — Repeatedly parsing the same file content for multiple

**Tags:** ast-grep, performance, parsing

Repeatedly parsing the same file content for multiple structural rules creates significant performance overhead. Parse the file once to create an AST root and execute all engine patterns against that cached object to minimize redundant parsing.

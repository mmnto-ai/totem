## Lesson — When parsing shell scripts to replace code blocks, a naive

**Tags:** shell, regex

When parsing shell scripts to replace code blocks, a naive regex for the `fi` keyword can prematurely match nested conditionals and cause syntax errors.

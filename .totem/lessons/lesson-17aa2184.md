## Lesson — Iterative string replacements for a list of identifiers

**Tags:** typescript, regex, performance

Iterative string replacements for a list of identifiers are less efficient than a single regex with an alternation group. Consolidating patterns into one expression improves performance and maintainability as the list of items to be stripped scales.

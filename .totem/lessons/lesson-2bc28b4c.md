## Lesson — Naive substring matching on paths, such as using

**Tags:** node, filesystem, regex

Naive substring matching on paths, such as using `.includes('adapters/')`, can incorrectly match unintended segments like `src/notadapters/`. Using regex boundaries or path-splitting ensures logic only applies to the intended directory structure.

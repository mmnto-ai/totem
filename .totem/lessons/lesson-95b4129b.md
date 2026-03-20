## Lesson — The author declined replacing multiple .filter() calls

**Tags:** typescript, performance, refactoring

The author declined replacing multiple `.filter()` calls with a single-loop partition because readability is more important for small data sets (e.g., <20 items). Micro-optimizing for performance at this scale adds unnecessary code complexity without meaningful gain.

## Lesson — Simple key-value string parsers often fail on standard YAML

**Tags:** yaml, parsing, robustness

Simple key-value string parsers often fail on standard YAML list syntax like `[val1, val2]`. Explicitly checking for and stripping square brackets ensures that manually parsed frontmatter remains compatible with common configuration patterns without requiring a heavy external parser dependency.

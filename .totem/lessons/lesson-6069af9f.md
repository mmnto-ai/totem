## Lesson — Dynamic string construction signals broken rules

**Tags:** dx, linting, patterns

Using workarounds like `'+'.repeat(3)` to bypass linting is a strong signal of an over-broad rule. These rules should be archived or refined rather than leaving workarounds in the codebase that increase friction for future authors.

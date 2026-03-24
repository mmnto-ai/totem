## Lesson — When implementing content filters, regression tests

**Tags:** testing, documentation, architecture

When implementing content filters, regression tests must cover both inline markers and directory-level bypasses (e.g., docs/manual/*) to ensure global policies don't overwrite trusted files.

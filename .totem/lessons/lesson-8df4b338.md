## Lesson — When transitioning schemas, the parser should only commit

**Tags:** architecture, parsing, resilience

When transitioning schemas, the parser should only commit to the new format if validation succeeds, falling back to legacy parsing on failure to prevent data loss or breakage.

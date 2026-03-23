## Lesson — When extracting plain text from markdown ASTs, ensure logic

**Tags:** markdown, parsing

When extracting plain text from markdown ASTs, ensure logic handles nodes with value or alt properties (like InlineCode or Image) and recurses into children to prevent data loss.

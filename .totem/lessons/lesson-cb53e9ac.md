## Lesson — Error catch blocks must mirror the successful path's

**Tags:** error-handling, xml, mcp

Error catch blocks must mirror the successful path's response format to ensure client-side XML parsers do not fail when encountering raw text error messages. Inconsistent response structures in error states often break downstream automated consumers.

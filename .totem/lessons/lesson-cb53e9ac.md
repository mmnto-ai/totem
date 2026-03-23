## Lesson — Match error and success response formats where possible

**Tags:** error-handling, xml, api

Error responses should match the success-path response format where client compatibility allows. Inconsistent structures can break downstream automated consumers. Exception: MCP tools may intentionally use plain-text error responses for client compatibility.

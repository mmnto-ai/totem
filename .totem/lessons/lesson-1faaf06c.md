## Lesson — Standard console.log or console.error calls in MCP tools

**Tags:** mcp, logging, error-handling

Standard `console.log` or `console.error` calls in MCP tools can corrupt the stdio transport protocol used for communication. Use dedicated file-based loggers or return formatted system warnings to the agent instead of swallowing errors in catch blocks.

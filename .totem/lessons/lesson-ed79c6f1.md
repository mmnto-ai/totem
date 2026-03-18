## Lesson — Individual CLI commands should throw standardized errors

**Tags:** cli, nodejs, patterns

Individual CLI commands should throw standardized errors with specific prefixes rather than logging and returning locally. This allows a central top-level handler to manage consistent exit codes, error formatting, and process lifecycle across the entire tool.

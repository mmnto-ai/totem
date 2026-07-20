## Lesson — Feed Claude CLI prompts via stdin

**Tags:** cli, anthropic, claude
**Scope:** packages/cli/**/*.ts, !**/*.test.*

The Claude CLI interprets positional file arguments as the prompt text itself rather than a path to a file containing the prompt. Use stdin redirection to correctly pass file-based prompts.

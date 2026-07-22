## Lesson — Guard LLM-specific replace tools

**Tags:** llm, security, git-hooks
**Scope:** packages/cli/src/commands/init-templates.ts

LLM write-time guards must intercept specific tool operations, such as Gemini's `replace` tool, rather than just raw file writes to prevent agents from bypassing bare-reference checks during automated edits.

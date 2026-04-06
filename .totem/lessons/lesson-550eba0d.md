## Lesson — Include failure cases in few-shot prompts

**Tags:** prompt-engineering, llm, testing
**Scope:** packages/cli/src/commands/compile-templates.ts

Incorporating concrete examples from previous benchmark failures (e.g., async/await in forEach) prevents the model from repeating known architectural mistakes.

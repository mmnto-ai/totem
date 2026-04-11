## Lesson — Guard committed files against LLM overwrites

**Tags:** git, llm, safety
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Standard dirty-file guards only catch uncommitted changes; protect hand-crafted documentation from aggressive LLM rewrites by checking git author dates or providing explicit skip flags.

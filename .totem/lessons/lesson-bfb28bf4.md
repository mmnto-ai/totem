## Lesson — Prevent context-less rule pollution

**Tags:** llm, rules, cli
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Defaulting LLM rule capture to OFF prevents 'warning waves' where context-less regex rules trigger violations on unrelated files across the codebase.

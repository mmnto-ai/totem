## Lesson — Prefer structural boundaries for diff truncation

**Tags:** git, diff, llm, prompting
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Truncating code diffs arbitrarily (mid-line or mid-hunk) can cause LLM extraction failures and lane abstentions. Diffs should be cut at file, hunk, or line boundaries with coverage floors to preserve sufficient context for model evaluation.

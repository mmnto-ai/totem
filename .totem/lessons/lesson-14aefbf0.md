## Lesson — Prioritize deterministic mechanism-tier gates

**Tags:** architecture, ci-cd, security
**Scope:** packages/cli/**/*.ts, packages/core/**/*.ts

Encode rules as deterministic mechanisms (e.g., file existence or link validation) rather than prose or LLM spot-checks to reliably block failures at pre-push time.

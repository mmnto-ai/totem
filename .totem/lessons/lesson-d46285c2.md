## Lesson — Guard review cache against forecast runs

**Tags:** cli, caching, security
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Deterministic estimates or forecasts must not stamp the push-gate review cache. Stamping the cache during a prediction run would allow subsequent push-gates to skip mandatory LLM verification.

## Lesson — Set higher timeouts for orchestrator tests

**Tags:** testing, vitest
**Scope:** packages/cli/**/*.test.ts

Orchestrator tests involving full CLI runs often exceed default execution limits. Set an explicit 15s timeout for these suites to prevent flaky CI failures during heavy workloads.

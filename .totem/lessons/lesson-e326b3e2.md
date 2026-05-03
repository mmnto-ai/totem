## Lesson — Validate path resolution with chdir

**Tags:** testing, monorepo, paths
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Simulate nested execution in tests by using process.chdir and mocking the configuration path to verify that path resolution logic correctly anchors to the config root. This ensures the tool remains robust in monorepo environments where the execution context is unpredictable.

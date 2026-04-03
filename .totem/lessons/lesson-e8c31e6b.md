## Lesson — Signal failure when safety filters drop all results

**Tags:** cli, ci-cd, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In non-interactive modes, if safety filters reject all generated output, the CLI must explicitly set a non-zero exit code before returning. This prevents CI/CD pipelines from incorrectly reporting success when the tool failed to produce valid results due to suspicion or validation checks.

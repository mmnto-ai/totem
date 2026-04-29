## Lesson — Order flag incompatibility guards first

**Tags:** cli, ux
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Run flag incompatibility checks before specific value validations to ensure users receive clear errors about conflicting options rather than misleading downstream constraints.

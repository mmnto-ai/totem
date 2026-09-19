## Lesson — Order status checks by database ID

**Tags:** github, api, ordering
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

The GitHub commit status rollup does not list check runs in chronological order, and a rerun mints a new check run with a greater id. Use the check run's strictly increasing `databaseId` as the ordinal to pick the latest run among same-named runs of one producer, never the list position; the order holds within one name and producer, not across names.

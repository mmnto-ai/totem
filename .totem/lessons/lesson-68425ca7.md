## Lesson — Validate fetched items against totalCount

**Tags:** api, validation, github
**Scope:** packages/cli/src/adapters/**/*.ts, !**/*.test.*, !**/*.spec.*

To prevent silent data truncation when fetching paginated resources, always compare the length of the fetched array against the API's total count field and fail loudly on any shortfall. Ensure the validation tolerates cases where the total count field is missing to remain compatible with older API versions.

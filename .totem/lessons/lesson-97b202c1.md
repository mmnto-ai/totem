## Lesson — REST pagination merges arrays automatically

**Tags:** github-cli, rest-api, pagination
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When using `gh api --paginate` on REST endpoints, the GitHub CLI automatically merges paginated results into a single JSON array. Do not use `--slurp` or attempt manual page-array flattening, as this will corrupt the parsed output.

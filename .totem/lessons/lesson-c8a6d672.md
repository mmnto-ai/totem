## Lesson — Measure a jq finding under the processor the command runs

**Tags:** jq, github-cli, json
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

A `gh api --jq` filter runs on the GitHub CLI's built-in jq processor, not a standalone `jq` binary, so a review finding about jq semantics is judged by executing the filter through `gh` against a real endpoint. Measured on gh 2.99.0: a null array element joins as an empty string and a number joins as its text, exit 0 in both cases, rather than throwing a fatal error. Deleted accounts are served as the `ghost` user object with a string login, never a null `user`, so a defensive `// "default"` on `.user.login`, `.commit_id` or `.submitted_at` guards a path the read cannot reach and is declined rather than folded.

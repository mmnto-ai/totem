## Lesson — Sanitize shell comments

**Tags:** cli, shell, security
**Scope:** packages/cli/**/*.ts, !**/*.test.*

CLI wrappers projecting shell commands must blank out comments, arithmetic expansions, and join backslash-newline continuations to prevent bypasses or misparsed arguments.

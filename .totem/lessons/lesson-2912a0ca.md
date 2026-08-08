## Lesson — Sanitize registry strings before console output

**Tags:** security, cli, terminal
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Always pass registry-controlled strings through a rendering helper before console interpolation to prevent ANSI escape sequences or newlines from manipulating terminal output.

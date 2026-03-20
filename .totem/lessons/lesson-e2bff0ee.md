## Lesson — Synchronous file operations are often preferable in CLI

**Tags:** performance, curated
**Pattern:** \bfs\.(promises|readFile|writeFile|readdir|mkdir|rm|stat|access|appendFile|copyFile|rename|unlink)\b|['"]fs/promises['"]
**Engine:** regex
**Scope:** packages/cli/**/*.ts, packages/cli/**/*.js, bin/**/*.ts, bin/**/*.js
**Severity:** warning

Synchronous file operations (e.g. readFileSync) are preferred in CLI tools for simplicity, as blocking the event loop is acceptable in short-lived processes.

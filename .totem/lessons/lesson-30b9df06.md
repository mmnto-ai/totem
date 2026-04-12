## Lesson — Prefer cross-spawn for Windows shim resolution

**Tags:** node, security, windows
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

Using `shell: true` to resolve Windows `.cmd` shims introduces shell injection risks; `cross-spawn` handles shim resolution safely without enabling the shell layer.

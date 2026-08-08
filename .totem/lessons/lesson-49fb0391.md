## Lesson — Manually expand tilde paths before resolution

**Tags:** filesystem, cli, ux
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Standard path resolution helpers do not expand leading tildes (~); manually resolve them against the user's home directory, or a shell-quoted `~` mints a literal `~` directory under the cwd — and anything derived from it (recorded roots, registry paths) persists the mistake.

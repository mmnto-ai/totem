## Lesson — Avoid shell-parsing command interceptors

**Tags:** security, cli, architecture
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Hand-rolled shell parsers designed to intercept and block CLI commands are highly prone to bypasses. Relying on server-side constraints, write-time guards, or repository configurations is a more robust approach to enforcing merge postures.

## Lesson — Use static argv arrays for CLI execution

**Tags:** cli, security
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Hardcoding CLI execution arguments as static arrays structurally prevents users or downstream processes from overriding critical flags like commit bodies or subjects.

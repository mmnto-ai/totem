## Lesson — Neutralize C1 and carriage return characters

**Tags:** security, cli
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Terminal sanitizers must explicitly target C1 control codes (U+0080–U+009F) and carriage returns (\r) to prevent attackers from rewinding or overwriting terminal lines.

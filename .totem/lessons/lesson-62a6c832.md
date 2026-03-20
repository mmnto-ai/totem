## Lesson — GCA may suggest reverting dynamic imports back to static

**Tags:** performance, curated
**Pattern:** import\s+(?!type\s)._\s+from\s+['"]@mmnto/totem['"]
**Engine:** regex
**Scope:** packages/cli/src/commands/\*\*/_.ts, !**/\*.test.ts
**Severity:\*\* warning

Use dynamic imports for @mmnto/totem in CLI command files to protect startup performance. Do not revert to static top-level imports.

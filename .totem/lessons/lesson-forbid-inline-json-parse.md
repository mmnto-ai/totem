## Lesson — Forbid inline JSON.parse(readFileSync) — use readJsonSafe

**Tags:** architecture, curated
**Pattern:** JSON\.parse\(\s*\S*readFileSync
**Engine:** regex
**Scope:** packages/core/src/**/*.ts, !packages/core/src/sys/**, !**/*.test.ts, !**/*.spec.ts
**Severity:** warning

Use `readJsonSafe` from the sys utilities instead of inline `JSON.parse(fs.readFileSync(...))`. The helper differentiates ENOENT (missing file) from SyntaxError (corrupt JSON) from ZodError (schema mismatch), throwing `TotemParseError` with ES2022 cause chains. Inline parsing duplicates error handling and loses diagnostic context.

## Lesson — 2026-03-03T02:16:24.772Z

**Tags:** style, curated
**Pattern:** \bstdio\s*:\s*._\.\bfd\b
**Engine:** regex
**Scope:** packages/cli/\*\*/_.ts, !**/\*.test.ts
**Severity:\*\* warning

Use fs.openSync() instead of fs.createWriteStream() for spawn() stdio. WriteStream.fd is null until the 'open' event fires, which will cause spawn() to fail.

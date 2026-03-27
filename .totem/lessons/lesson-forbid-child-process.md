## Lesson — Forbid direct child_process — use safeExec

**Tags:** architecture, security, curated
**Pattern:** (?:from|require\()\s*['"](?:node:)?child_process['"]
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !packages/core/src/sys/**, !**/*.test.ts, !**/*.spec.ts, !**/*.test.js, !**/*.spec.js
**Severity:** error

Direct use of `node:child_process` is forbidden outside of the sys utilities. Use `safeExec` from `@mmnto/totem` instead. It handles cross-platform shell requirements (Windows `shell: true`), UTF-8 encoding, 10MB maxBuffer default, auto-trimming, and ES2022 error cause chains. Importing child_process directly leads to duplicated platform boilerplate and inconsistent error handling.

## Lesson — Always iterate through all regex matches (e.g.,

**Tags:** architecture, curated
**Pattern:** \.(match|exec)\s*\(
**Engine:** regex
**Scope:** packages/cli/src/adapters/**/*.ts, packages/mcp/src/**/*.ts, !**/*.test.ts
**Severity:** error

Always iterate through all regex matches (e.g., via matchAll) rather than just checking the first. Relying on the first match allows 'shadowing' where an attacker prefixes a payload with a safe match to hide a malicious one later in the same text.

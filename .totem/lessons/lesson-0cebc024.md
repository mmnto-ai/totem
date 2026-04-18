## Lesson — Strengthen security allowlist drift guards

**Tags:** testing, security
**Scope:** packages/pack-agent-security/test/repo-sweep.test.ts

Allowlists keyed only by file path allow new unauthorized patterns to be introduced into already-exempted files. Validate exact match counts or line numbers to ensure allowlists only cover known, justified exceptions.

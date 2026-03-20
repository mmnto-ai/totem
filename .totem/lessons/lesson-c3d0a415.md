## Lesson — 2026-03-02T09:18:21.092Z

**Tags:** architecture, curated
**Pattern:** \bos\.tmpdir\(\)
**Engine:** regex
**Scope:** _.ts, _.js, !_.test.ts, !_.spec.ts
**Severity:** error

Do not use os.tmpdir() for agent-readable files; use workspace-local paths (e.g., '.totem/temp/') to satisfy MCP boundary restrictions.

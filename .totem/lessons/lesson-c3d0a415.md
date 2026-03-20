## Lesson — 2026-03-02T09:18:21.092Z

**Tags:** architecture, curated
**Pattern:** \bos\.tmpdir\(\)
**Engine:** regex
**Scope:** *.ts, *.js, !*.test.ts, !*.spec.ts
**Severity:** error

Do not use os.tmpdir() for agent-readable files; use workspace-local paths instead.

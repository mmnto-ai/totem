## Lesson — 2026-03-03T01:51:33.783Z

**Tags:** architecture, curated
**Pattern:** \.(includes|match|indexOf|search)\(\s*['"`].*-o\s+json.*['"`]\s*\)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.py, **/*.sh
**Severity:** error

Do not hardcode CLI flags like "-o json" in string matching; use structured argument parsing.

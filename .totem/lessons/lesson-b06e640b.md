## Lesson — Orchestrators must dynamically adjust max_tokens based

**Tags:** security, curated
**Pattern:** \bmax_?[tT]okens\b\s*:\s*\d+
**Engine:** regex
**Scope:** **/*orchestrator*/**/*.ts, **/orchestrators/**/*.ts, **/*orchestrator*.ts, !**/*.test.ts
**Severity:** error

Orchestrators must dynamically adjust max_tokens based.

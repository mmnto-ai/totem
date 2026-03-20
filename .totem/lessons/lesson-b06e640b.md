## Lesson — Orchestrators must dynamically adjust max_tokens based

**Tags:** security, curated
**Pattern:** \bmax_?[tT]okens\b\s*:\s*\d+
**Engine:** regex
**Scope:** **/*orchestrator*/**/*.ts, **/orchestrators/**/*.ts, **/*orchestrator*.ts, !**/*.test.ts
**Severity:** error

Do not hardcode max_tokens. Orchestrators must dynamically adjust this value based on the specific model to prevent API failures or truncation.

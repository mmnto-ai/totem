## Lesson — Orchestrators must dynamically adjust max_tokens based

**Tags:** security, curated
**Pattern:** \bmax\_?[tT]okens\b\s*:\s*\d+
**Engine:** regex
**Scope:** **/_orchestrator_/**/_.ts, **/orchestrators/**/_.ts, **/_orchestrator_.ts, !**/\*.test.ts
**Severity:** error

Do not hardcode max_tokens. Orchestrators must dynamically adjust this value based on the specific model to prevent API failures or truncation.

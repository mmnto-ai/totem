## Lesson — 2026-03-06T05:32:34.074Z

**Tags:** style, curated
**Pattern:** Promise\.allSettled
**Engine:** regex
**Scope:** **/cli/**/_.ts, **/totem/**/_.ts, **/orchestrator/**/\*.ts
**Severity:** warning

Strictly enforce 'Fail Fast' for multi-input orchestrator commands. Use Promise.all instead of Promise.allSettled; partial context assembly (e.g., missing one of several PRs) can lead to LLM hallucinations based on incomplete information.

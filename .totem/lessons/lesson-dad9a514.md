## Lesson — Refine security rules at the source definition

**Tags:** architecture, security
**Scope:** packages/pack-agent-security/test/**/*.ts, !**/*.test.*, !**/*.spec.*

Always address rule flaws by refining the source patterns or specs rather than manually editing `compiled-rules.json`, as manual changes are overwritten during the compilation cycle.

## Lesson — Apply fail-closed defaults selectively to cohorts

**Tags:** architecture, governance, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

To prevent spamming external consumers, the crown gate ladder bypasses non-cohort repositories while enforcing a strict fail-closed 'crown vacant' default for cohort repositories lacking a declared marker.

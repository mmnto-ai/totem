## Lesson — When a basename is reused as a shared handled-marker key,

**Tags:** ecl, mail, identity, collision, genuine-domain

**Applies-to:** boundary

When a basename is reused as a shared handled-marker key, detect distinct writers before treating the basename as unique; derive writer identity from the owning outbox directory, not a forgeable `from:` field. (Sweep TOTEM-SWEEP-001; anchor: #2311 hazard, fixed #2321 @ 2b142281.)

**Source:** mcp (added at 2026-07-12T03:07:56.572Z)

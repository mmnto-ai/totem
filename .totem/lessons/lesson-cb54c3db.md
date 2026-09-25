## Lesson — Align negative match suppression with core runtime

**Tags:** review-triage, absence-construct, requires, ast-grep, regex
**Scope:** operations-local/gate5/mig-harness.mjs

A bot's "inverted logic" claim on an absence construct (a record's requires: clause) is checked against the core helper's DIRECTION, never against the helper's or the field's name. requiresSuppressesMatch in packages/core/src/spine/record-runtime.ts suppresses a match on the PRESENCE of the requirement in the window, so a record fires exactly when the requirement does NOT match there; a harness that fires on absence implements the same semantics and is not inverted. On mmnto-ai/totem#2945 the "critical" inverted-requires finding was false at source and was declined; the fix it proposed would have inverted the harness away from the runtime.

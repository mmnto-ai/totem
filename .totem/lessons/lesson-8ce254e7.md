## Lesson — Classify additive schema changes as minor

**Tags:** semver, schema, api-design

A breaking schema change can be downgraded to a minor bump if the success path remains additive and the field is consumed as rendered text rather than parsed JSON. This prevents devaluing major version signals for isolated changes with negligible programmatic impact.

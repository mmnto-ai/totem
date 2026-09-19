## Lesson — Decouple configuration readers from consumer hooks

**Tags:** documentation, architecture, configuration
**Scope:** packages/**/*.ts, !**/*.test.*

Avoid documenting external consumer-side scripts as the exclusive readers of shared configuration files when independent internal validation steps also process them. Documenting them as replaceable clarifies architectural independence and prevents inaccurate assumptions.

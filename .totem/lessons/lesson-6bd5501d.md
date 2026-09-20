## Lesson — Enforce parser parity

**Tags:** testing, parsing, fuzzing
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Ports of complex parser logic must enforce strict parity via automated fuzz testing against the original scanner to guarantee zero divergent or fail-open behaviors.

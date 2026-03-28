## Lesson — Incremental validation must confirm the previous commit

**Tags:** git, validation, performance

Incremental validation must confirm the previous commit is a direct ancestor before evaluating deltas. This prevents applying partial reviews to divergent branches where the base state is unverified.

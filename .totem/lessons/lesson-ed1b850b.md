## Lesson — Relying on string matching for error logic is an acceptable

**Tags:** typescript, design-patterns

Relying on string matching for error logic is an acceptable trade-off when checking output from a co-located, internally-defined function. This avoids the complexity of structured return types for one-time health checks where the string source is tightly controlled.

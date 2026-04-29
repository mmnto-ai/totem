## Lesson — Execute rule engine for accurate predictions

**Tags:** cli, architecture
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Run the actual rule engine instead of simple glob matching when predicting findings. Users require anchored citations (file:line) and severity levels which static scope matching cannot provide.

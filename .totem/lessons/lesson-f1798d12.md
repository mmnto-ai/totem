## Lesson — Limiting incremental fast-paths to small changes (e.g., <

**Tags:** llm, architecture, performance

Limiting incremental fast-paths to small changes (e.g., < 15 lines) ensures the model maintains high precision without losing context. Larger changes or new files should trigger a full-context review to catch cross-functional regressions.

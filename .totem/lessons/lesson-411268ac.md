## Lesson — Avoid aborting entire parallel LLM batches on single

**Tags:** async, llm, error-handling

Avoid aborting entire parallel LLM batches on single network failures by catching errors at the individual task level. Logging a warning and continuing is preferred for LLM-bound tasks where intermittent failures are common.

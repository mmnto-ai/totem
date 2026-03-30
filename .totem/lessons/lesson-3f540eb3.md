## Lesson — Secondary outputs like JSON checkpoints should be wrapped

**Tags:** error-handling, resilience

Secondary outputs like JSON checkpoints should be wrapped in try/catch blocks. This ensures that a failure in a non-critical side effect does not crash the primary command or block the user's main workflow.

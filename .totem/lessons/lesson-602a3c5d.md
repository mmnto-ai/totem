## Lesson — Operations like saving metrics or telemetry are secondary

**Tags:** error-handling, resilience, cli

Operations like saving metrics or telemetry are secondary to the main command and should never cause it to fail. Wrapping these side effects in try-catch blocks ensures "resilient continuation," where the tool logs a warning but completes its primary task.

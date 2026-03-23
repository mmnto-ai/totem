## Lesson — Ensure test names and assertions accurately distinguish

**Tags:** ai, testing, resilience

Ensure test names and assertions accurately distinguish between intentional fallback behavior, such as zero-vector returns, and actual exceptions. Mislabeling a recovery path as a throw hides the fact that the system is successfully absorbing the error.

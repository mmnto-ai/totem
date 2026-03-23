## Lesson — Incrementing usage counters only after a successful

**Tags:** security, rate-limiting, architecture

Incrementing usage counters only after a successful operation prevents users from exhausting their session quota with failed validation attempts or non-fatal errors. This ensures the rate limit accurately reflects actual resource consumption rather than total attempts.

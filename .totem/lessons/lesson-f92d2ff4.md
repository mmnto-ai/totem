## Lesson — Marking test callbacks as async and awaiting synchronous

**Tags:** testing, typescript

Marking test callbacks as async and awaiting synchronous functions masks the actual API signature and prevents tests from detecting accidental conversions to Promises. Ensure tests reflect the synchronous nature of utilities to catch regressions in function return types.

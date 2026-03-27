## Lesson — Unconditionally deleting environment variables in test

**Tags:** testing, dev-experience

Unconditionally deleting environment variables in test cleanup can leak state and cause failures in other tests. Always capture the original value and restore it to ensure proper test isolation.

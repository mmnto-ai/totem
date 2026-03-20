## Lesson — Spying on underlying implementation details

**Tags:** testing, mocking, logging

Spying on underlying implementation details like `console.error` instead of the project's public logging utility makes tests fragile to internal changes. Targeting the higher-level API ensures tests remain robust even if the logging library's transport mechanism or internal implementation changes.

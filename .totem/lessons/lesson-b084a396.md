## Lesson — Consume separate wrapper option operands

**Tags:** shell, parsing, security
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Transparent wrapper parsers must explicitly consume options that take separate operands (like `sudo -R <chroot>`) to prevent leftover operands from being misclassified as command targets.

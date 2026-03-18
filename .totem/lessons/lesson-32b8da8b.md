## Lesson — Avoid unifying logic between different engines

**Tags:** refactoring, software-design, maintainability

Avoid unifying logic between different engines if their underlying execution models, such as async batch queries versus sync individual matching, differ significantly. Prematurely forcing a shared helper before a common abstraction like YAML rules exists can increase code complexity rather than reducing it.

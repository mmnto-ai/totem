## Lesson — Always restore global or module-level handlers, such

**Tags:** testing, typescript, architecture

Always restore global or module-level handlers, such as custom warning listeners, in an afterEach block to prevent cross-test state leakage.

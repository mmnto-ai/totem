## Lesson — Test markdown markers for registered transforms

**Tags:** documentation, testing, validation
**Scope:** tools/docs-transforms.test.cjs

Build-time markdown injection tools often fail silently when encountering unregistered or misspelled template markers. Adding a test that validates every document marker against registered transforms ensures configuration errors fail loud.

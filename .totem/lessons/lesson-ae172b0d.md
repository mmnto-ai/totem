## Lesson — Avoid over-broad git diff header regex

**Tags:** git, regex, testing
**Scope:** .totem/compiled-rules.json

Regex patterns targeting git diff headers like `+++ b/` must specifically check for quotes or spaces to avoid flagging legitimate test fixtures that mock plain file paths. Over-broad patterns break tests that use literal diff strings, forcing developers to use dynamic string workarounds.

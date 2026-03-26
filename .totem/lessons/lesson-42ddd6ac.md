---
tags: ["ast-grep", "architecture", "tooling"]
lifecycle: nursery
---

## Lesson — When generating ast-grep patterns programmatically,

**Tags:** ast-grep, architecture, tooling

When generating ast-grep patterns programmatically, the pattern must be emitted as a raw code string rather than wrapped in backticks or quotes. ast-grep parses patterns into AST nodes; wrapping a pattern in backticks (e.g., ` `JSON.parse($A)` `) causes the engine to match a template literal string node instead of the intended call expression, breaking structural matching.

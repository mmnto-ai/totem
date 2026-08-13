## Lesson — Do not prematurely optimize RegExp compilation

**Tags:** performance, regex, javascript
**Scope:** packages/cli/src/parsers/triage-severity-mapper.ts

Dynamically compiling literal-based regular expressions is extremely fast and does not require caching if the function is executed infrequently (e.g., once per finding).

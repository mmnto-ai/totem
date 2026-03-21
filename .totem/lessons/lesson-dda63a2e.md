## Lesson — Escape metacharacters in RegExp interpolation

**Tags:** security, regex, javascript

Always escape metacharacters when interpolating dynamic strings into a `RegExp` constructor to ensure they are treated as literal matches. This prevents regex injection where malicious input could manipulate matching logic or trigger catastrophic backtracking.

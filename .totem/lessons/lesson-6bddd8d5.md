## Lesson — Metacharacters must be escaped when interpolating dynamic

**Tags:** security, regex

Metacharacters must be escaped when interpolating dynamic strings into regular expressions to prevent regex injection attacks. This ensures that dynamic input is treated as a literal string rather than being interpreted as executable regex syntax.

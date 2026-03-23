## Lesson — When redacting tokens like sk-proj- and sk-, the longest

**Tags:** security, secrets, regex

When redacting tokens like `sk-proj-` and `sk-`, the longest patterns must be evaluated first to prevent shorter prefixes from matching and leaving sensitive fragments exposed.

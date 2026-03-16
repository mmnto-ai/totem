## Lesson — When masking secrets with assignment patterns, use capture

**Tags:** regex, security, typescript

When masking secrets with assignment patterns, use capture groups and a replacer function to redact only the sensitive value. Replacing the entire regex match removes the key and assignment syntax, making the resulting data harder to categorize or debug.

## Lesson — When detecting tool-generated blocks for removal, match

**Tags:** cli, regex, security

When detecting tool-generated blocks for removal, match sentinel markers using line-start regex or strict equality rather than simple substring inclusion. This prevents accidental over-scrubbing if the marker string appears within a user's comment or a standard line of code.

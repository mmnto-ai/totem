## Lesson — Auto-formatters like Prettier can mangle technical metadata

**Tags:** markdown, prettier, globs, validation

Auto-formatters like Prettier can mangle technical metadata by escaping underscores and asterisks in Markdown files, which breaks glob matching logic. Validation logic should explicitly check for these escaped characters (`\_`, `\*`) to ensure scope patterns remain valid for tools.

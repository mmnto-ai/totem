## Lesson — Prettier interprets asterisks and underscores as markdown

**Tags:** markdown, prettier, globs

Prettier interprets asterisks and underscores as markdown emphasis, which can mangle technical strings like `**/*.tsx` into `**/_.tsx`. Directories containing sensitive regex or glob patterns must be added to `.prettierignore` to preserve functional syntax.

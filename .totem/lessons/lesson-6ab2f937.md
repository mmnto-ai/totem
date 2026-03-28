## Lesson — Git commands used for programmatic parsing should be

**Tags:** git, i18n, parsing

Git commands used for programmatic parsing should be prefixed with `LC_ALL=C` to ensure consistent, locale-independent output. This prevents parsing failures when the user's environment uses a non-English language.

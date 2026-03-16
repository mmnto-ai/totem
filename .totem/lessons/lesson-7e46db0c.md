## Lesson — When loading optional configuration or cache files,

**Tags:** nodejs, error-handling, validation

When loading optional configuration or cache files, differentiate between `ENOENT` (missing file) and validation or corruption errors. This allows the system to silently initialize defaults for missing files while still reporting actionable warnings to the user when existing files are unreadable.

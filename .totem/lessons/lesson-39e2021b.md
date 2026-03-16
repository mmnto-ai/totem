## Lesson — When reading cache or config files, specifically check

**Tags:** nodejs, fs, error-handling

When reading cache or config files, specifically check for the `ENOENT` error code to handle missing files silently. Swallowing all errors hides critical issues like file permission problems or JSON corruption that should be surfaced to the user.

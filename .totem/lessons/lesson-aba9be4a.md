## Lesson — Simple regex patterns for file extensions often fail

**Tags:** regex, glob, linting

Simple regex patterns for file extensions often fail to match brace-expanded globs like `**/*.{ts,tsx}`, requiring explicit expansion to ensure full linting coverage.

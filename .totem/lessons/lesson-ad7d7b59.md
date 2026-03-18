## Lesson — Using .includes() to identify target files like READMEs

**Tags:** nodejs, path-handling, documentation

Using `.includes()` to identify target files like READMEs is prone to false positives from directory paths or similar filenames. Use `path.basename()` with case-insensitivity to ensure logic only applies to the exact intended file.

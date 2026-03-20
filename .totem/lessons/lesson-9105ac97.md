## Lesson — To support mixed file formats in a single directory, use

**Tags:** architecture, validation, linting

To support mixed file formats in a single directory, use presence-checks for "signature fields" (like `**Pattern:**`) to trigger specific validation gates. This allows specialized metadata checks for one format without causing false-positive failures in other valid but differently-structured files.

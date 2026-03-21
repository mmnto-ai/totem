## Lesson — When refactoring a single instruction file into a root file

**Tags:** testing, nodejs, documentation

When refactoring a single instruction file into a root file plus sub-documents, update consistency tests to recursively read and concatenate all fragments before comparison. This ensures that cross-agent rule validation remains effective even when the documentation structure diverts from a simple single-file pattern.

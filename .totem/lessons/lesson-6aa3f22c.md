## Lesson — Handle Git merge-base exit code 128

**Tags:** git, error-handling
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

An exit code of 128 from `git merge-base --is-ancestor` indicates an unscannable repository or missing reference rather than a simple negative ancestry result.

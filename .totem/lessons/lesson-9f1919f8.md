---
tags: ["architecture", "logic", "globbing"]
lifecycle: nursery
---

## Lesson — When identifying files by naming conventions (e.g.,

**Tags:** architecture, logic, globbing

When identifying files by naming conventions (e.g., matching `*.test.*` or `*.spec.*`), perform the match against the file's basename rather than the full path. Using `path.includes()` on a full path can lead to false positives if a directory segment matches the infix, misclassifying non-target files.

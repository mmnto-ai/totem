---
tags: ["logic", "filesystem", "architecture"]
lifecycle: nursery
---

## Lesson — When implementing path-based filtering for patterns

**Tags:** logic, filesystem, architecture

When implementing path-based filtering for patterns like `*.test.*` or `*.spec.*`, always match against the file's basename rather than the full normalized path. Using `includes()` on a full path results in false positives when a directory segment matches the infix, incorrectly classifying non-test files within test-related directories.

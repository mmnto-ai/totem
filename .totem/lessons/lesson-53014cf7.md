## Lesson — Using exact length assertions like toHaveLength() instead

**Tags:** testing, vitest, quality

Using exact length assertions like `toHaveLength()` instead of `toBeGreaterThanOrEqual()` in parser tests catches regressions where content is incorrectly over-split or empty segments are not properly filtered.

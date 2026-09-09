## Lesson — Ignore code blocks when parsing severity

**Tags:** parsing, markdown, security
**Scope:** packages/core/src/merge-ready.ts

When parsing bot comments for severity markers, strip code blocks and fenced spans first to prevent false positives from quoted source code or docstrings.

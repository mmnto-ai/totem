## Lesson — When identifying directory-based glob patterns (like

**Tags:** glob, security, matching

When identifying directory-based glob patterns (like `dir/*.ts`), ensure the separator check excludes index 0. This prevents the logic from misinterpreting repo-relative paths as root-anchored, which can bypass intended security or scope constraints.

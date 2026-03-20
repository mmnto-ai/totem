## Lesson — Do not automatically append trailing slashes to path

**Tags:** api-design, filesystem, search

Do not automatically append trailing slashes to path boundaries, as this prevents filtering for specific files rather than directories. Letting callers control the trailing slash enables both directory-wide and file-specific search scopes.

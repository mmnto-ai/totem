## Lesson — When detecting markers in user-authored files, use

**Tags:** regex, parsing, migration

When detecting markers in user-authored files, use line-start regex (`/^marker/m`) instead of simple string search. This prevents file corruption during migration if a user happens to include the marker string within their content body.

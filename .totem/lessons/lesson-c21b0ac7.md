## Lesson — Always verify that glob entries are strings before calling

**Tags:** typescript, safety, globs

Always verify that glob entries are strings before calling methods like startsWith, as heterogeneous arrays in rule configurations can cause runtime failures during linting.

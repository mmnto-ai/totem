## Lesson — When batch functions process complex objects as input keys,

**Tags:** patterns, collections, ast-grep

When batch functions process complex objects as input keys, returning an indexed array is often cleaner and safer than using a Map. Map keys involving objects rely on reference equality, which can cause retrieval failures if those objects are cloned or recreated during the processing pipeline.

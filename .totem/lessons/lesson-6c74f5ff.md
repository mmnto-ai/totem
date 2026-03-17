## Lesson — Perform explicit null and type checks on the results

**Tags:** typesafety, nodejs, json

Perform explicit null and type checks on the results of `JSON.parse` for lock files before accessing properties like `pid`. Direct type assertions (`as LockData`) can mask `TypeError` risks if a lock file is concurrently truncated, malformed, or empty.

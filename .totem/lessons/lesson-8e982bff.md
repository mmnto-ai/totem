## Lesson — Never cache transient attribution checks

**Tags:** caching, security, attribution
**Scope:** packages/core/src/**/*.ts, !**/*.test.*

Caching transient environment checks can convert a temporary contamination, such as a sessionless seat inheriting another's attribution, into a persistent, session-wide error. Perform attribution sensing per call to ensure transient state changes are accurately captured.

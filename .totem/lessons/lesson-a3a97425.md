## Lesson — Escape backticks in SQL predicates

**Tags:** security, sql, database

Ensure backticks are included in escaping logic alongside single quotes and wildcards when building SQL predicates or `LIKE` clauses. This prevents identifier-based injection attacks in databases that use backticks for quoting.

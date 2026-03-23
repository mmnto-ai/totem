## Lesson — In the DataFusion SQL dialect, backslashes are treated

**Tags:** sql, datafusion, security

In the DataFusion SQL dialect, backslashes are treated as literal characters rather than escape sequences, so string literals must be sanitized by doubling single quotes.

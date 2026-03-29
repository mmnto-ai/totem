## Lesson — When searching for numeric IDs like ticket numbers, always

**Tags:** regex, grep

When searching for numeric IDs like ticket numbers, always use word boundaries or non-digit anchors. This prevents false positives where a short ticket ID (e.g., '12') incorrectly matches a substring of a longer ID (e.g., '123').

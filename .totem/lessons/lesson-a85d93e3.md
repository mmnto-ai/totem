## Lesson — Prefer using null instead of an empty array when metadata

**Tags:** api-design, schema

Prefer using null instead of an empty array when metadata is unavailable or unknown. This prevents downstream consumers from incorrectly treating a missing data point as an authoritatively empty list.

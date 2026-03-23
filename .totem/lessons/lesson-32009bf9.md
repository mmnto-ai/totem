## Lesson — Parsers with legacy fallbacks should treat 'JSON detected

**Tags:** llm, parsing, architecture

Parsers with legacy fallbacks should treat 'JSON detected but empty' as a terminal success state rather than a failure to prevent unintended and potentially insecure fallback to regex-based extraction.

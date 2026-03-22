## Lesson — Exact-match regexes for HTML tags fail on valid variants

**Tags:** regex, html, parsing

Exact-match regexes for HTML tags fail on valid variants that include attributes (e.g., `<details open>`) or non-standard whitespace. Case-insensitive patterns with word boundaries and attribute wildcards are required for resilient extraction of metadata from review bodies.

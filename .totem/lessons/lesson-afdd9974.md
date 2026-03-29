## Lesson — Functions with 'OrExit' suffixes must actually terminate

**Tags:** dx, naming-conventions

Functions with 'OrExit' suffixes must actually terminate the process on failure rather than returning empty results. Misleading names cause callers to skip necessary error handling for empty states.

## Lesson — When fetching with a limit across multiple sources,

**Tags:** api, aggregation, logic

When fetching with a limit across multiple sources, applying the limit to each source before merging results in up to limit * N items. Truncate the final sorted array to ensure the output strictly honors the user's requested limit.
